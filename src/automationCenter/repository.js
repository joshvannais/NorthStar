'use strict';

const centerContract = require('../../public/js/automation-center-contract');

const MAX_ROWS = 100;
const ROLE_CAPABILITIES = Object.freeze({
  owner: Object.freeze([
    'automation_view', 'automation_policy_draft', 'automation_run_approve',
    'automation_standing_authority_activate', 'automation_standing_authority_change',
    'automation_pause', 'automation_retry_reviewed', 'automation_evidence_export',
    'automation_channel_availability_manage', 'automation_tenant_stop_operate',
  ]),
  admin: Object.freeze([
    'automation_view', 'automation_policy_draft', 'automation_pause',
    'automation_evidence_export', 'automation_tenant_stop_operate',
  ]),
});
const RECORD_LABELS = Object.freeze({
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
});
const POLICY_STATE_LABELS = Object.freeze({
  draft: 'Draft', validated: 'Validated', previewed: 'Preview ready', active: 'Recorded active', paused: 'Paused',
  superseded: 'Superseded', expired: 'Expired', retired: 'Retired', emergency_stopped: 'Stopped',
  draining: 'Stopping safely', drained: 'Stopped', revoked_terminal: 'Revoked',
  superseded_terminal: 'Superseded', active_resumed: 'Recorded active', bulk_stopped_terminal: 'Stopped',
});
const POLICY_LIFECYCLE_STATES = Object.freeze([
  'draft', 'validated', 'previewed', 'active', 'paused', 'superseded', 'expired', 'retired', 'emergency_stopped',
]);
const DELIVERY_CONTROL_STATES = Object.freeze([
  'paused', 'revoked_terminal', 'superseded_terminal', 'draining', 'drained', 'active_resumed',
  'cancelled_terminal', 'expired_terminal', 'dead_lettered_terminal', 'bulk_stopped_terminal',
]);
const CHANNEL_EVIDENCE_LABELS = Object.freeze({
  ready_internal_no_effect: 'Private owner work is available without contacting a customer.',
  unavailable_manual_handoff_not_opened: 'Manual device handoff is not available.',
  unavailable_external_channel: 'External delivery is not available.',
  unavailable_all_external_provider_adapters_disabled: 'External delivery services are unavailable.',
  unavailable_no_accepted_external_authority: 'External delivery authority is not available.',
  unavailable_no_accepted_external_customer_channel: 'No approved external customer channel is available.',
  unavailable_no_authenticated_callback_authority: 'Delivery confirmation is unavailable.',
  unavailable_no_tenant_bound_provider_account_or_credential: 'A connected delivery service is unavailable.',
  unavailable_no_provider_resilience_authority: 'Delivery service recovery is unavailable.',
});

function centerError(status, code, message) {
  return Object.assign(new Error(message || code), { status, code });
}
function bounded(rows, label) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    throw centerError(503, 'AUTOMATION_CENTER_BOUNDED_READ_REQUIRED', `${label} could not be shown safely.`);
  }
  return rows;
}
function iso(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function safeId(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value : null;
}
function exactPolicyLifecycle(row, evaluatedAt) {
  const expiresAt = iso(row.expires_at || row.policy_expires_at);
  const checkedAt = iso(evaluatedAt);
  if (row.lifecycle_currentness !== 'exact_current_not_runtime_revalidated' ||
      !POLICY_LIFECYCLE_STATES.includes(row.lifecycle_state) ||
      !expiresAt || !checkedAt) {
    return { id: 'unavailable', label: 'Current policy status unavailable' };
  }
  const expired = new Date(expiresAt).getTime() <= new Date(checkedAt).getTime();
  const state = expired ? 'expired' : row.lifecycle_state;
  return { id: state, label: POLICY_STATE_LABELS[state] || 'Current policy status unavailable' };
}
function policyState(row, evaluatedAt) {
  const lifecycle = exactPolicyLifecycle(row, evaluatedAt);
  if (lifecycle.id !== 'active') return lifecycle;
  if (!row.control_state || row.control_state === 'active_resumed') return lifecycle;
  if (!DELIVERY_CONTROL_STATES.includes(row.control_state)) {
    return { id: 'unavailable', label: 'Current policy status unavailable' };
  }
  return { id: row.control_state, label: POLICY_STATE_LABELS[row.control_state] || 'Stopped' };
}
function projectedRunState(id) {
  return {
    id,
    label: centerContract.RUN_STATE_LABELS[id],
    explanation: centerContract.RUN_STATE_EXPLANATIONS[id],
  };
}
function recordCurrentness(row) {
  if (row.currentness_marker === 'captured_exact_current' ||
      row.currentness_marker === 'captured_not_runtime_revalidated') return null;
  if (row.currentness_marker === 'captured_stale' ||
      row.currentness_marker === 'captured_stale_fail_closed' ||
      row.currentness_marker === 'captured_runtime_revalidation_required') {
    return projectedRunState('stale', 'Recorded evidence requires exact currentness revalidation.');
  }
  return projectedRunState('unavailable', 'Current run evidence is missing or unavailable.');
}
function terminalRunState(row) {
  const states = {
    completed_internal: ['completed', 'Exact terminal evidence records completed internal work; it does not claim a business outcome.'],
    suppressed: ['suppressed', 'Exact terminal evidence records suppression.'],
    cancelled: ['stopped', 'Exact terminal evidence records cancellation.'],
    failed: ['failed', 'Exact terminal evidence records failure.'],
    unavailable: ['unavailable', 'Terminal evidence records an unavailable outcome.'],
    uncertain: ['uncertain', 'Terminal evidence records an uncertain outcome that must not be retried or strengthened.'],
  };
  const match = states[row.terminal_state];
  return match
    ? projectedRunState(match[0], match[1])
    : projectedRunState('unavailable', 'A terminal evidence class exists, but its exact terminal state is unavailable.');
}
function restrictivePolicyRunState(lifecycle) {
  if (lifecycle.id === 'paused') return projectedRunState('paused', 'The exact policy-version lifecycle is paused.');
  if (lifecycle.id === 'expired') return projectedRunState('expired', 'The exact policy version is expired.');
  if (['draft', 'validated', 'previewed'].includes(lifecycle.id)) {
    return projectedRunState('validation', 'The policy has not reached an exact active lifecycle state.');
  }
  if (['superseded', 'retired', 'emergency_stopped'].includes(lifecycle.id)) {
    return projectedRunState('stopped', 'The exact policy-version lifecycle blocks further work.');
  }
  return projectedRunState('unavailable', 'Current policy-version lifecycle authority is unavailable.');
}
function controlRunState(controlState, executionPhase, activeLease) {
  if (!controlState || controlState === 'active_resumed') {
    if (controlState !== 'active_resumed') return null;
    if (executionPhase === 'queued') return projectedRunState('queued', 'Exact recorded work is ready for processing.');
    if (executionPhase === 'leased') return activeLease
      ? projectedRunState('in_flight', 'Exact recorded processing is in progress.')
      : projectedRunState('recovery', 'Recorded in-progress work is no longer current and requires recovery review.');
    if (executionPhase === 'uncertain') return projectedRunState('uncertain', 'Exact recorded work requires reconciliation with no resend.');
    if (executionPhase === 'permanent_stop_no_effect') return projectedRunState('failed', 'Exact recorded work ended without an external effect.');
    if (executionPhase === 'permanent_stop_effect_or_unknown') return projectedRunState('uncertain', 'Exact recorded work ended with an effect-or-unknown result.');
    return projectedRunState('unavailable', 'Current processing status is unavailable.');
  }
  if (['paused', 'draining'].includes(controlState)) return projectedRunState('paused', 'A current delivery control pauses or drains this work.');
  if (controlState === 'expired_terminal') return projectedRunState('expired', 'A current delivery control records expiry.');
  if (controlState === 'dead_lettered_terminal') return projectedRunState('failed', 'A current delivery control records a reviewed permanent failure.');
  if (controlState === 'reviewed_retry_new_action_required') return projectedRunState('recovery', 'Owner review requires a separate new action; prior work is not reused.');
  if (['drained', 'revoked_terminal', 'superseded_terminal', 'cancelled_terminal', 'bulk_stopped_terminal'].includes(controlState)) {
    return projectedRunState('stopped', 'A current delivery control records a terminal stop.');
  }
  return projectedRunState('unavailable', 'Current work status is unavailable.');
}
function runState(row, evaluatedAt) {
  const currentness = recordCurrentness(row);
  if (currentness) return currentness;
  if (row.latest_record_type === 'terminal_outcome') return terminalRunState(row);
  const policyLifecycle = exactPolicyLifecycle({
    lifecycle_state: row.policy_lifecycle_state,
    lifecycle_currentness: row.policy_lifecycle_currentness,
    policy_expires_at: row.policy_expires_at,
  }, evaluatedAt);
  if (policyLifecycle.id !== 'active') return restrictivePolicyRunState(policyLifecycle);
  const checkedAt = iso(evaluatedAt);
  const leaseExpiresAt = iso(row.lease_expires_at);
  const leaseAcquiredAt = iso(row.lease_acquired_at);
  const retryUpdatedAt = iso(row.retry_updated_at);
  const retryNextAttemptAt = iso(row.retry_next_attempt_at);
  const actionControlUpdatedAt = iso(row.action_control_updated_at);
  const recoveryRecordedAt = iso(row.recovery_recorded_at);
  const leasePresent = Boolean(row.lease_id || row.lease_acquired_at || row.lease_expires_at);
  const leaseComplete = Boolean(row.lease_id && leaseAcquiredAt && leaseExpiresAt);
  const activeLease = Boolean(leaseComplete && checkedAt &&
    new Date(leaseExpiresAt).getTime() > new Date(checkedAt).getTime());
  const tenantControl = row.tenant_control_state;
  const policyControl = row.policy_control_state;
  const actionControl = row.action_control_state || row.control_state;
  // Migration 279 blocks non-resumed tenant/policy scope and every recorded
  // action-schedule control. The read projection must never present a run as
  // active when the authoritative delivery guard would reject new activity.
  if (tenantControl && tenantControl !== 'active_resumed') return controlRunState(tenantControl, 'scope', false);
  if (policyControl && policyControl !== 'active_resumed') return controlRunState(policyControl, 'scope', false);
  if (Number(row.schedule_count || 0) > 1 || Number(row.action_unit_count || 0) > 1) {
    return projectedRunState('unavailable', 'This run has multiple action units or schedules; one selected schedule cannot establish a truthful whole-run state.');
  }
  if (actionControl && actionControl !== 'active_resumed') {
    return controlRunState(actionControl, row.action_execution_phase, activeLease);
  }
  if (leasePresent && !leaseComplete) {
    return projectedRunState('unavailable', 'Recorded processing evidence is incomplete.');
  }
  if (leasePresent && !row.schedule_id) {
    return projectedRunState('unavailable', 'Recorded processing evidence is missing its exact work binding.');
  }
  const retryStates = [
    'retry_scheduled_no_effect', 'reconciliation_required_no_resend', 'permanent_stop_terminal',
    'permanent_stop_attempt_ceiling', 'permanent_stop_effect_confirmed', 'permanent_stop_unknown_or_unsafe',
  ];
  if (row.retry_state && !retryStates.includes(row.retry_state)) {
    return projectedRunState('unavailable', 'Retry evidence is outside the accepted state catalog.');
  }
  if (row.retry_state && !row.schedule_id) {
    return projectedRunState('unavailable', 'Retry evidence is missing its exact schedule binding.');
  }
  if (row.retry_state === 'retry_scheduled_no_effect' && !retryNextAttemptAt) {
    return projectedRunState('unavailable', 'Retry evidence is missing its trusted next-attempt time.');
  }
  if (row.retry_state && !retryUpdatedAt) {
    return projectedRunState('unavailable', 'Retry evidence is missing its trusted decision time.');
  }
  const recoveryStates = [
    'bounded_history_verified_no_effect', 'wait_for_active_lease_no_effect',
    'reconciliation_required_no_resend', 'blocked_source_not_latest_exact_current',
    'disaster_restore_evidence_gap_no_authority',
  ];
  if (row.recovery_state && !recoveryStates.includes(row.recovery_state)) {
    return projectedRunState('unavailable', 'Recovery evidence is outside the accepted state catalog.');
  }
  let nonblockingRecoverySuperseded = false;
  if (row.recovery_state) {
    const exactRecoveryBinding = recoveryRecordedAt && row.recovery_transaction_id &&
      row.recovery_policy_id && row.recovery_policy_version != null &&
      String(row.recovery_policy_id) === String(row.policy_id) &&
      String(row.recovery_policy_version) === String(row.policy_version);
    if (!exactRecoveryBinding) {
      return projectedRunState('unavailable', 'Recovery evidence is missing its exact policy, transaction, or trusted-time binding.');
    }
    const nonblockingRecovery = row.recovery_state === 'bounded_history_verified_no_effect' ||
      row.recovery_state === 'wait_for_active_lease_no_effect';
    if (nonblockingRecovery) {
      const executionTimes = [];
      const executionEvidencePresent = leasePresent || Boolean(row.retry_state) || Boolean(actionControl);
      if (executionEvidencePresent) {
        if (!row.schedule_id || !row.schedule_transaction_id ||
            String(row.schedule_transaction_id) !== String(row.recovery_transaction_id)) {
          return projectedRunState('unavailable', 'Recorded recovery and processing evidence do not share one exact transaction binding.');
        }
        if (leasePresent) executionTimes.push(leaseAcquiredAt);
        if (row.retry_state) executionTimes.push(retryUpdatedAt);
        if (actionControl) {
          if (!actionControlUpdatedAt) {
            return projectedRunState('unavailable', 'Current work evidence is missing its trusted decision time.');
          }
          executionTimes.push(actionControlUpdatedAt);
        }
        if (executionTimes.some(value => !value)) {
          return projectedRunState('unavailable', 'Recorded processing evidence is missing a trusted decision time.');
        }
        const latestExecutionTime = Math.max(...executionTimes.map(value => new Date(value).getTime()));
        nonblockingRecoverySuperseded = latestExecutionTime > new Date(recoveryRecordedAt).getTime();
      }
    }
  }
  if (row.recovery_state === 'blocked_source_not_latest_exact_current') {
    return projectedRunState('stale', 'Recovery evidence records a source that is not latest exact current.');
  }
  if (row.recovery_state === 'disaster_restore_evidence_gap_no_authority') {
    return projectedRunState('unavailable', 'Current recovery status is unavailable because restore evidence is incomplete.');
  }
  if (row.recovery_state === 'reconciliation_required_no_resend') {
    return projectedRunState('uncertain', 'Recovery evidence requires reconciliation with no resend.');
  }
  if (row.retry_state === 'reconciliation_required_no_resend') {
    return projectedRunState('uncertain', 'Retry authority records an uncertain outcome and blocks resend.');
  }
  if (row.retry_state === 'permanent_stop_unknown_or_unsafe' || row.retry_state === 'permanent_stop_effect_confirmed') {
    return projectedRunState('uncertain', 'Retry authority records a terminal effect-or-unknown outcome.');
  }
  if (row.retry_state === 'permanent_stop_terminal' || row.retry_state === 'permanent_stop_attempt_ceiling') {
    return projectedRunState('failed', 'Retry authority records a permanent stop.');
  }
  const scheduleExpiresAt = iso(row.schedule_expires_at);
  if (row.schedule_expires_at && (!row.schedule_id || !scheduleExpiresAt)) {
    return projectedRunState('unavailable', 'Schedule expiry evidence is incomplete or invalid.');
  }
  const scheduleExpired = Boolean(scheduleExpiresAt && checkedAt &&
    new Date(scheduleExpiresAt).getTime() <= new Date(checkedAt).getTime());
  if (scheduleExpired && (activeLease || row.retry_state === 'retry_scheduled_no_effect')) {
    return projectedRunState('uncertain', 'Expired schedule evidence conflicts with retained active execution evidence and needs review.');
  }
  if (scheduleExpired) {
    return projectedRunState('expired', 'The exact schedule is expired.');
  }
  if (!nonblockingRecoverySuperseded && (row.recovery_state === 'wait_for_active_lease_no_effect' ||
      row.recovery_state === 'bounded_history_verified_no_effect')) {
    return projectedRunState('recovery', 'A bounded recovery assessment is recorded; it grants no resend or effect authority.');
  }
  if (row.retry_state === 'retry_scheduled_no_effect' && activeLease) {
    if (leaseAcquiredAt && retryUpdatedAt && new Date(leaseAcquiredAt).getTime() > new Date(retryUpdatedAt).getTime()) {
      return projectedRunState('in_flight', 'A newer exact in-progress record supersedes the retained retry schedule evidence.');
    }
    return projectedRunState('uncertain', 'Future retry and in-progress evidence conflict and need review.');
  }
  if (activeLease) return projectedRunState('in_flight', 'Exact recorded processing is in progress.');
  if (row.retry_state === 'retry_scheduled_no_effect') {
    return projectedRunState('queued', 'Retry authority records a future no-effect retry schedule.');
  }
  if (leaseComplete && !activeLease) return projectedRunState('recovery', 'The latest recorded processing claim is expired and requires recovery review.');
  if (actionControl) return controlRunState(actionControl, row.action_execution_phase, activeLease);
  if (row.latest_record_type === 'eligibility_evaluation') {
    if (row.eligibility_state === 'approval_required') return projectedRunState('approval', 'Eligibility evidence requires approval.');
    if (row.eligibility_state === 'suppressed') return projectedRunState('suppressed', 'Eligibility evidence records suppression.');
    if (row.eligibility_state === 'unavailable') return projectedRunState('unavailable', 'Eligibility evidence is unavailable.');
    if (row.eligibility_state === 'ineligible') return projectedRunState('stopped', 'Eligibility evidence records that this work is not eligible.');
    if (row.eligibility_state === 'eligible') return projectedRunState('validation', 'Eligibility is recorded; later execution state evidence is unavailable.');
  }
  if (row.latest_record_type === 'proposed_action') return projectedRunState('validation', 'A proposed action is recorded but has no later current state evidence.');
  if (row.latest_record_type === 'approval') {
    if (row.approval_state === 'unavailable_pending_part3') return projectedRunState('approval', 'Approval evidence is pending or unavailable.');
    if (row.approval_state === 'expired') return projectedRunState('expired', 'Approval evidence is expired.');
    if (row.approval_state === 'denied' || row.approval_state === 'revoked') return projectedRunState('stopped', 'Approval evidence denies or revokes authority.');
    if (row.approval_state === 'approved') return projectedRunState('validation', 'Approval history is recorded; later execution state evidence is unavailable.');
  }
  if (row.latest_record_type === 'scheduled_run') {
    if (row.schedule_record_state === 'expired') return projectedRunState('expired', 'Recorded schedule evidence is expired.');
    return projectedRunState('unavailable', 'Schedule existence alone does not prove queued or in-flight work.');
  }
  if (row.latest_record_type === 'action_unit') {
    if (row.unit_state === 'blocked' || row.unit_state === 'cancelled') return projectedRunState('stopped', 'Action-unit evidence records blocked or cancelled work.');
    return projectedRunState('unavailable', 'Action-unit evidence alone does not prove queued or in-flight work.');
  }
  if (['provider_attempt', 'provider_acknowledgement', 'delivery_state'].includes(row.latest_record_type)) {
    return projectedRunState('uncertain', 'Provider or delivery evidence does not establish a completed business outcome.');
  }
  if (row.latest_record_type === 'reply_opt_out') {
    return (row.reply_authenticated === true || row.reply_authenticated === 'true') &&
      (row.suppression_required === true || row.suppression_required === 'true')
      ? projectedRunState('suppressed', 'Exact reply or opt-out evidence requires suppression.')
      : projectedRunState('uncertain', 'Authenticated reply or opt-out suppression evidence is unavailable.');
  }
  if (row.latest_record_type === 'suppression') {
    return row.suppression_blocks_effect === true || row.suppression_blocks_effect === 'true'
      ? projectedRunState('suppressed', 'Exact suppression evidence blocks the effect.')
      : projectedRunState('unavailable', 'Suppression evidence does not prove that the effect is blocked.');
  }
  if (row.latest_record_type === 'cancellation') {
    if (row.cancellation_state === 'accepted') return projectedRunState('stopped', 'Exact cancellation evidence records acceptance.');
    if (row.cancellation_state === 'requested') return projectedRunState('validation', 'Cancellation is requested, but acceptance is not recorded.');
    if (row.cancellation_state === 'too_late') return projectedRunState('uncertain', 'Cancellation was too late; effect evidence requires review.');
    return projectedRunState('unavailable', 'Cancellation evidence is unavailable and does not prove a stop.');
  }
  if (row.latest_record_type === 'reconciliation') {
    if (row.reconciliation_state === 'corrected') return projectedRunState('corrected', 'Exact reconciliation evidence records a correction while preserving prior evidence.');
    if (row.reconciliation_state === 'conflicting' || row.reconciliation_state === 'uncertain') {
      return projectedRunState('uncertain', 'Reconciliation evidence remains conflicting or uncertain.');
    }
    if (row.reconciliation_state === 'consistent') return projectedRunState('recovery', 'Exact reconciliation evidence is consistent; it grants no new effect authority.');
  }
  return projectedRunState('unavailable', 'No exact supported current run state can be derived from the recorded evidence.');
}
function templateProjection() {
  return centerContract.TEMPLATES.map(template => ({
    id: template.id,
    name: template.name,
    description: template.description,
    sourceClassId: template.sourceClassId,
    actionFamily: template.actionFamily,
    recipientClass: template.recipientClass,
    channelId: template.channelId,
    timing: template.timing,
  }));
}
function channelEvidence(row) {
  if (!row || typeof row.result_state !== 'string') return 'Channel evidence is unavailable.';
  return Object.prototype.hasOwnProperty.call(CHANNEL_EVIDENCE_LABELS, row.result_state)
    ? CHANNEL_EVIDENCE_LABELS[row.result_state]
    : 'Channel evidence is unavailable and needs review.';
}
function channelProjection(rows) {
  const observed = new Map(rows.map(row => [row.requested_channel_id, row]));
  return ['in_app_passive', 'email', 'sms', 'secure_link', 'native_handoff'].map(id => {
    const row = observed.get(id === 'native_handoff' ? 'native_manual_handoff' : id);
    const internal = id === 'in_app_passive';
    return {
      id,
      label: centerContract.CHANNEL_LABELS[id],
      state: internal ? 'available_internal_only' : 'unavailable',
      status: internal ? 'Available for private owner work' : 'External delivery is not available',
      evidence: channelEvidence(row),
      providerMode: internal ? 'No external delivery used' : 'External delivery disabled',
    };
  });
}
function limitsProjection() {
  return {
    state: 'minimum_safety_limits_only',
    label: 'Minimum safety limits apply',
    dailyMaximum: 25,
    currentConsumption: null,
    currentConsumptionLabel: 'Current consumption is unavailable',
    boundaries: [
      'Missing or uncertain usage never counts as zero',
      'External recipients, provider attempts, upstream changes, and money effects remain unavailable without exact current authority',
      'A company policy cannot weaken mandatory safety limits',
    ],
  };
}
function stopProjection(row) {
  if (!row) return {
    state: 'normal_no_control_record',
    label: 'No recorded company-wide stop',
    canEngage: false,
    canRelease: false,
    explanation: 'The accepted tenant-wide stop release authority is not jointly mounted in this slice. Policy and run safeguards remain visible in their exact records.',
  };
  return {
    state: row.control_state,
    label: POLICY_STATE_LABELS[row.control_state] || 'Company-wide control recorded',
    canEngage: false,
    canRelease: false,
    explanation: 'This recorded stop remains authoritative. Releasing it requires separate exact current authority and is unavailable here.',
  };
}
function buildSnapshot(input, results) {
  const evaluatedAt = iso(results.evaluatedAt);
  const policies = bounded(results.policies, 'Policies').map(row => {
    const state = policyState(row, evaluatedAt);
    return {
      id: safeId(row.policy_id),
      version: Number(row.version),
      name: centerContract.ACTION_LABELS[row.action_family] || 'Automation policy',
      source: centerContract.SOURCE_LABELS[row.source_class_id] || 'Source review required',
      action: centerContract.ACTION_LABELS[row.action_family] || 'Action review required',
      channel: centerContract.CHANNEL_LABELS[row.channel_id] || 'Channel review required',
      state: state.id,
      stateLabel: state.label,
      expiresAt: iso(row.expires_at),
      recordedAt: iso(row.recorded_at),
      canPause: false,
      controlExplanation: 'Controls require a current mounted authority decision; this view never infers one.',
    };
  });
  const runs = bounded(results.runs, 'Runs').map(row => {
    const state = runState(row, evaluatedAt);
    return {
      id: safeId(row.run_id),
      policyId: safeId(row.policy_id),
      policyVersion: Number(row.policy_version),
      state: state.id,
      stateLabel: state.label,
      stateExplanation: state.explanation,
      latestEvent: RECORD_LABELS[row.latest_record_type] || 'Evidence record captured',
      recordedAt: iso(row.latest_recorded_at || row.recorded_at),
      evidenceState: row.currentness_marker === 'captured_exact_current'
        ? 'Captured evidence; not live revalidated'
        : 'Currentness requires review',
    };
  });
  const recordRows = bounded(results.records, 'Timeline');
  const documentRows = bounded(results.documents, 'Document timeline');
  if (recordRows.length + documentRows.length > MAX_ROWS) {
    throw centerError(503, 'AUTOMATION_CENTER_BOUNDED_READ_REQUIRED', 'Timeline could not be shown safely.');
  }
  const timeline = recordRows.map(row => ({
    id: safeId(row.record_id),
    runId: safeId(row.run_id),
    kind: row.record_type,
    label: RECORD_LABELS[row.record_type] || 'Automation evidence recorded',
    recordedAt: iso(row.recorded_at),
    evidenceState: row.authority_class === 'effect_evidence' ? 'Effect evidence' : 'Decision evidence',
  }));
  for (const row of documentRows) {
    timeline.push({
      id: safeId(row.estimate_quote_resolution_id),
      runId: safeId(row.run_id),
      kind: 'document_review',
      label: row.result_state === 'exact_document_bound_external_delivery_unavailable'
        ? 'Approved estimate document ready; external delivery unavailable'
        : 'Document delivery review required',
      recordedAt: iso(row.recorded_at),
      evidenceState: 'Exact document binding',
    });
  }
  timeline.sort((left, right) => String(right.recordedAt).localeCompare(String(left.recordedAt)));
  const ownerWork = recordRows.filter(row => row.record_type === 'internal_task').map(row => ({
    id: safeId(row.record_id),
    runId: safeId(row.run_id),
    label: 'Private owner work evidence',
    state: 'historical_status_unavailable',
    statusLabel: 'Current pending or resolved task status is unavailable.',
    recordedAt: iso(row.recorded_at),
  }));
  // Immutable approval records are evidence, not a pending-inbox resolver. Do
  // not turn their existence or absence into a pending count or action authority.
  const approvals = null;
  const runStates = Object.fromEntries(centerContract.RUN_STATE_ORDER.map(state => [state, 0]));
  for (const run of runs) runStates[run.state] += 1;
  const counts = {
    policies: policies.length,
    activePolicies: policies.filter(item => item.state === 'active').length,
    pausedPolicies: policies.filter(item => item.state === 'paused' || item.state === 'draining' || item.state === 'drained').length,
    unavailablePolicies: policies.filter(item => item.state === 'unavailable').length,
    runs: runs.length,
    runStates,
    approvals: null,
    ownerWork: null,
  };
  const stopRows = bounded(results.stopControl, 'Stop controls');
  if (stopRows.length > 1) {
    throw centerError(503, 'AUTOMATION_CENTER_CONTROL_AMBIGUOUS', 'Company-wide stop controls could not be resolved safely.');
  }
  const stopControl = stopProjection(stopRows[0] || null);
  const status = {
    id: stopControl.state !== 'normal_no_control_record' ? 'stopped_or_restricted'
      : policies.length === 0 ? 'ready_to_set_up'
        : counts.unavailablePolicies > 0 || ['approval', 'uncertain', 'failed', 'stale', 'unavailable']
          .some(state => counts.runStates[state] > 0) ? 'attention_needed'
          : 'recorded_evidence_available',
    label: stopControl.state !== 'normal_no_control_record' ? 'Company-wide control recorded'
      : policies.length === 0 ? 'Ready to set up'
        : counts.unavailablePolicies > 0 ? 'Policy status unavailable'
          : ['approval', 'uncertain', 'failed', 'stale', 'unavailable'].some(state => counts.runStates[state] > 0)
            ? 'Review needed' : 'Recorded automation evidence',
    explanation: stopControl.state !== 'normal_no_control_record'
      ? 'The recorded company-wide control remains authoritative. No release is inferred or available here.'
      : policies.length === 0
      ? 'No policies are recorded for this company. Preview a bounded setup without creating an effect.'
      : counts.unavailablePolicies > 0
        ? 'One or more policy records lack exact lifecycle, currentness, or expiry authority. Known counts remain recorded evidence, not live runtime revalidation.'
        : ['approval', 'uncertain', 'failed', 'stale', 'unavailable'].some(state => counts.runStates[state] > 0)
          ? 'One or more run records require approval, reconciliation, correction review, or exact current evidence. No missing state is treated as permission or success.'
          : 'Review recorded policy, run, and evidence states before changing authority. Recorded evidence is not live runtime revalidation.',
  };
  return centerContract.validateSnapshot({
    version: centerContract.VERSION,
    status,
    counts,
    policies,
    runs,
    approvals,
    timeline,
    ownerWork,
    limits: limitsProjection(),
    channels: channelProjection(bounded(results.channels, 'Channels')),
    stopControl,
    templates: templateProjection(),
    capabilities: ROLE_CAPABILITIES[input.actorAccessRole].slice(),
    unavailableEvidence: [
      'Pending approval inbox resolution and approval actions are not jointly mounted',
      'Current limit consumption and provider availability are not mounted',
      'External messages, recipients, provider attempts, delivery, replies, outcomes, and money effects are unavailable and unclaimed',
      'Tenant-wide stop release, private-production evidence, professional review, and founder visual approval are unavailable and unclaimed',
    ],
    evaluatedAt,
  });
}

async function readAutomationCenter(pool, input) {
  if (!pool || typeof pool.connect !== 'function') throw centerError(503, 'AUTOMATION_CENTER_UNAVAILABLE');
  if (!input || !ROLE_CAPABILITIES[input.actorAccessRole] || !input.organizationId || !input.actorUserId || !input.authSessionId) {
    throw centerError(403, 'AUTOMATION_CENTER_RESTRICTED');
  }
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='5s'");
    await client.query("SELECT set_config('northstar.automation_tenant_id',$1,true)", [input.organizationId]);
    const evaluatedAt = (await client.query('SELECT statement_timestamp() evaluated_at')).rows[0].evaluated_at;
    const policies = (await client.query(`
      WITH latest_policy AS (
        SELECT DISTINCT ON (policy_id) policy_id,version,canonical_digest,document,expires_at,recorded_at
        FROM public.canonical_automation_policy_versions_v1
        WHERE organization_id=$1 ORDER BY policy_id,version DESC
      )
      SELECT p.policy_id,p.version,p.expires_at,p.recorded_at,
        p.document#>>'{trigger,sourceClassId}' source_class_id,
        p.document#>>'{action,familyId}' action_family,
        p.document#>>'{channel,channelId}' channel_id,
        lifecycle.to_state lifecycle_state,lifecycle.currentness_marker lifecycle_currentness,
        control.control_state
      FROM latest_policy p
      LEFT JOIN LATERAL (
        SELECT to_state,currentness_marker FROM public.canonical_automation_lifecycle_events_v1
        WHERE organization_id=$1 AND policy_id=p.policy_id AND policy_version=p.version
        ORDER BY lifecycle_sequence DESC LIMIT 1
      ) lifecycle ON TRUE
      LEFT JOIN public.canonical_automation_delivery_control_heads_v1 control
        ON control.organization_id=$1 AND control.target_kind='policy_version'
        AND control.policy_id=p.policy_id AND control.policy_version=p.version
      ORDER BY p.recorded_at DESC,p.policy_id LIMIT ${MAX_ROWS + 1}`, [input.organizationId])).rows;
    const runs = (await client.query(`
      SELECT binding.run_id,binding.policy_id,binding.policy_version,binding.recorded_at,
        latest.record_type latest_record_type,latest.currentness_marker,latest.recorded_at latest_recorded_at,
        latest.document#>>'{payload,resultState}' eligibility_state,
        latest.document#>>'{payload,authorityState}' approval_state,
        latest.document#>>'{payload,scheduleState}' schedule_record_state,
        latest.document#>>'{payload,unitState}' unit_state,
        latest.document#>>'{payload,suppressionCode}' suppression_code,
        latest.document#>>'{payload,blocksEffect}' suppression_blocks_effect,
        latest.document#>>'{payload,cancellationState}' cancellation_state,
        latest.document#>>'{payload,authenticated}' reply_authenticated,
        latest.document#>>'{payload,suppressionRequired}' suppression_required,
        latest.document#>>'{payload,reconciliationState}' reconciliation_state,
        latest.document#>>'{payload,terminalState}' terminal_state,
        run_policy.expires_at policy_expires_at,
        policy_lifecycle.to_state policy_lifecycle_state,
        policy_lifecycle.currentness_marker policy_lifecycle_currentness,
        schedule.schedule_id,schedule.transaction_id schedule_transaction_id,
        schedule.expires_at schedule_expires_at,schedule.schedule_count,
        units.action_unit_count,retry.state retry_state,
        retry.next_attempt_at retry_next_attempt_at,retry.updated_at retry_updated_at,
        lease.lease_id,lease.lease_acquired_at,lease.lease_expires_at,
        recovery.transaction_id recovery_transaction_id,recovery.policy_id recovery_policy_id,
        recovery.policy_version recovery_policy_version,
        recovery.result_state recovery_state,recovery.recorded_at recovery_recorded_at,
        tenant_control.control_state tenant_control_state,
        policy_control.control_state policy_control_state,
        action_control.control_state action_control_state,
        action_control.execution_phase action_execution_phase,
        action_control.updated_at action_control_updated_at
      FROM public.canonical_automation_historical_run_bindings_v1 binding
      JOIN public.canonical_automation_policy_versions_v1 run_policy
        ON run_policy.organization_id=$1 AND run_policy.policy_id=binding.policy_id
        AND run_policy.version=binding.policy_version
      LEFT JOIN LATERAL (
        SELECT to_state,currentness_marker FROM public.canonical_automation_lifecycle_events_v1
        WHERE organization_id=$1 AND policy_id=binding.policy_id AND policy_version=binding.policy_version
        ORDER BY lifecycle_sequence DESC LIMIT 1
      ) policy_lifecycle ON TRUE
      LEFT JOIN LATERAL (
        SELECT record_type,currentness_marker,recorded_at,document FROM public.canonical_automation_records_v1
        WHERE organization_id=$1 AND run_id=binding.run_id ORDER BY causal_ordinal DESC LIMIT 1
      ) latest ON TRUE
      LEFT JOIN LATERAL (
        SELECT schedule_id,transaction_id,expires_at,count(*) OVER() schedule_count FROM public.canonical_automation_action_schedules_v1
        WHERE organization_id=$1 AND run_id=binding.run_id ORDER BY recorded_at DESC LIMIT 1
      ) schedule ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*)::integer action_unit_count FROM public.canonical_automation_action_units_v1
        WHERE organization_id=$1 AND run_id=binding.run_id
      ) units ON TRUE
      LEFT JOIN public.canonical_automation_delivery_retry_heads_v1 retry
        ON retry.organization_id=$1 AND retry.schedule_id=schedule.schedule_id
      LEFT JOIN public.canonical_automation_delivery_lease_heads_v1 lease
        ON lease.organization_id=$1 AND lease.schedule_id=schedule.schedule_id
      LEFT JOIN LATERAL (
        SELECT transaction_id,policy_id,policy_version,result_state,recorded_at
        FROM public.canonical_automation_recovery_assessments_v1
        WHERE organization_id=$1 AND run_id=binding.run_id
        ORDER BY recorded_at DESC,recovery_id DESC LIMIT 1
      ) recovery ON TRUE
      LEFT JOIN public.canonical_automation_delivery_control_heads_v1 tenant_control
        ON tenant_control.organization_id=$1 AND tenant_control.target_kind='tenant'
        AND tenant_control.target_key=$1::text
      LEFT JOIN public.canonical_automation_delivery_control_heads_v1 policy_control
        ON policy_control.organization_id=$1 AND policy_control.target_kind='policy_version'
        AND policy_control.target_key=binding.policy_id::text||':'||binding.policy_version::text
      LEFT JOIN public.canonical_automation_delivery_control_heads_v1 action_control
        ON action_control.organization_id=$1 AND action_control.target_kind='action_schedule'
        AND action_control.target_key=schedule.schedule_id::text
      WHERE binding.organization_id=$1
      ORDER BY COALESCE(latest.recorded_at,binding.recorded_at) DESC,binding.run_id LIMIT ${MAX_ROWS + 1}`, [input.organizationId])).rows;
    const records = (await client.query(`
      SELECT record_id,run_id,record_type,currentness_marker,authority_class,recorded_at
      FROM public.canonical_automation_records_v1 WHERE organization_id=$1
      ORDER BY recorded_at DESC,record_id LIMIT ${MAX_ROWS + 1}`, [input.organizationId])).rows;
    const documents = (await client.query(`
      SELECT estimate_quote_resolution_id,run_id,result_state,recorded_at
      FROM public.canonical_automation_estimate_quote_resolutions_v1 WHERE organization_id=$1
      ORDER BY recorded_at DESC,estimate_quote_resolution_id LIMIT ${MAX_ROWS + 1}`, [input.organizationId])).rows;
    const channels = (await client.query(`
      SELECT DISTINCT ON (requested_channel_id) requested_channel_id,capability_state,result_state,recorded_at
      FROM public.canonical_automation_channel_resolutions_v1 WHERE organization_id=$1
      ORDER BY requested_channel_id,recorded_at DESC LIMIT ${MAX_ROWS + 1}`, [input.organizationId])).rows;
    const stopControl = (await client.query(`
      SELECT control_state,control_sequence,queued_count,leased_count,uncertain_count,permanent_stop_count,updated_at
      FROM public.canonical_automation_delivery_control_heads_v1
      WHERE organization_id=$1 AND target_kind='tenant' AND target_key=$1::text LIMIT 2`, [input.organizationId])).rows;
    const snapshot = buildSnapshot(input, { evaluatedAt, policies, runs, records, documents, channels, stopControl });
    await client.query('COMMIT');
    return snapshot;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => { discard = true; });
    if (error && error.status) throw error;
    if (error && ['40001', '40P01'].includes(error.code)) throw centerError(409, 'AUTOMATION_CENTER_CHANGED');
    if (error && error.code === '42501') throw centerError(403, 'AUTOMATION_CENTER_RESTRICTED');
    throw centerError(503, 'AUTOMATION_CENTER_UNAVAILABLE');
  } finally {
    await client.query('RESET ALL').catch(() => { discard = true; });
    client.release(discard);
  }
}

module.exports = {
  CHANNEL_EVIDENCE_LABELS,
  MAX_ROWS,
  ROLE_CAPABILITIES,
  buildSnapshot,
  readAutomationCenter,
};
