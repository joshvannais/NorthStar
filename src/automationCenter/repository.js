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
  eligibility_evaluation: 'Eligibility checked',
  proposed_action: 'Action prepared for review',
  approval: 'Approval evidence recorded',
  scheduled_run: 'Run scheduled',
  action_unit: 'Action prepared',
  provider_attempt: 'Provider attempt recorded',
  provider_acknowledgement: 'Provider acknowledgement recorded',
  delivery_state: 'Delivery evidence updated',
  reply_opt_out: 'Reply or opt-out recorded',
  internal_task: 'Owner work recorded',
  suppression: 'Action stopped by a current safeguard',
  cancellation: 'Action cancelled',
  reconciliation: 'Prior outcome reconciled',
  terminal_outcome: 'Run reached a terminal state',
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
function runState(row, evaluatedAt) {
  if (row.currentness_marker !== 'captured_exact_current') {
    return { id: 'failed', label: 'Currentness needs review' };
  }
  if (row.latest_record_type === 'terminal_outcome') return { id: 'completed', label: 'Completed' };
  const policyLifecycle = exactPolicyLifecycle({
    lifecycle_state: row.policy_lifecycle_state,
    lifecycle_currentness: row.policy_lifecycle_currentness,
    policy_expires_at: row.policy_expires_at,
  }, evaluatedAt);
  if (policyLifecycle.id !== 'active') {
    return {
      id: policyLifecycle.id === 'paused' ? 'paused' : 'failed',
      label: policyLifecycle.label,
    };
  }
  const tenantControl = row.tenant_control_state;
  const policyControl = row.policy_control_state;
  const actionControl = row.action_control_state || row.control_state;
  // Migration 279 blocks non-resumed tenant/policy scope and every recorded
  // action-schedule control. The read projection must never present a run as
  // active when the authoritative delivery guard would reject new activity.
  const control = tenantControl && tenantControl !== 'active_resumed' ? tenantControl
    : policyControl && policyControl !== 'active_resumed' ? policyControl
      : actionControl || null;
  if (control) {
    const paused = /paused|draining|drained/.test(control);
    const terminal = /stopped|cancelled|expired|dead_lettered|revoked|superseded/.test(control);
    return {
      id: paused ? 'paused' : 'failed',
      label: paused || terminal ? (POLICY_STATE_LABELS[control] || 'Stopped') : 'Control needs review',
    };
  }
  if (row.retry_state === 'reconciliation_required_no_resend') return { id: 'failed', label: 'Outcome needs review' };
  if (row.retry_state && row.retry_state.indexOf('permanent_stop_') === 0) return { id: 'failed', label: 'Stopped after failure' };
  if (row.schedule_id) return { id: 'active', label: 'Scheduled record' };
  return { id: 'active', label: 'In-progress record' };
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
      latestEvent: RECORD_LABELS[row.latest_record_type] || 'Current evidence recorded',
      recordedAt: iso(row.latest_recorded_at || row.recorded_at),
      evidenceState: row.currentness_marker === 'captured_exact_current'
        ? 'Captured evidence; not live revalidated'
        : 'Currentness requires review',
    };
  }).filter(run => run.state !== 'completed');
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
  const terminalRunIds = new Set(recordRows
    .filter(row => row.record_type === 'terminal_outcome' || row.record_type === 'cancellation')
    .map(row => row.run_id));
  const ownerWork = recordRows.filter(row => row.record_type === 'internal_task').map(row => ({
    id: safeId(row.record_id),
    runId: safeId(row.run_id),
    label: 'Private owner work evidence',
    state: 'historical_status_unavailable',
    statusLabel: terminalRunIds.has(row.run_id)
      ? 'Terminal evidence is also recorded. Current task status is unavailable.'
      : 'Current pending or resolved task status is unavailable.',
    recordedAt: iso(row.recorded_at),
  }));
  // Immutable approval records are evidence, not a pending-inbox resolver. Do
  // not turn their existence or absence into a pending count or action authority.
  const approvals = null;
  const counts = {
    policies: policies.length,
    activePolicies: policies.filter(item => item.state === 'active').length,
    pausedPolicies: policies.filter(item => item.state === 'paused' || item.state === 'draining' || item.state === 'drained').length,
    activeRuns: runs.filter(item => item.state === 'active').length,
    pausedRuns: runs.filter(item => item.state === 'paused').length,
    failedRuns: runs.filter(item => item.state === 'failed').length,
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
      : policies.length === 0 ? 'ready_to_set_up' : counts.failedRuns > 0 ? 'attention_needed' : 'current',
    label: stopControl.state !== 'normal_no_control_record' ? 'Company-wide control recorded'
      : policies.length === 0 ? 'Ready to set up' : counts.failedRuns > 0 ? 'Review needed' : 'Automation records current',
    explanation: stopControl.state !== 'normal_no_control_record'
      ? 'The recorded company-wide control remains authoritative. No release is inferred or available here.'
      : policies.length === 0
      ? 'No policies are recorded for this company. Preview a bounded setup without creating an effect.'
      : 'Review exact policy, run, and evidence records before changing authority.',
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
        run_policy.expires_at policy_expires_at,
        policy_lifecycle.to_state policy_lifecycle_state,
        policy_lifecycle.currentness_marker policy_lifecycle_currentness,
        schedule.schedule_id,retry.state retry_state,
        tenant_control.control_state tenant_control_state,
        policy_control.control_state policy_control_state,
        action_control.control_state action_control_state
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
        SELECT record_type,currentness_marker,recorded_at FROM public.canonical_automation_records_v1
        WHERE organization_id=$1 AND run_id=binding.run_id ORDER BY causal_ordinal DESC LIMIT 1
      ) latest ON TRUE
      LEFT JOIN LATERAL (
        SELECT schedule_id FROM public.canonical_automation_action_schedules_v1
        WHERE organization_id=$1 AND run_id=binding.run_id ORDER BY recorded_at DESC LIMIT 1
      ) schedule ON TRUE
      LEFT JOIN public.canonical_automation_delivery_retry_heads_v1 retry
        ON retry.organization_id=$1 AND retry.schedule_id=schedule.schedule_id
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
