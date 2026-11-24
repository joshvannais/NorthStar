'use strict';

const runtime = require('./runtimeEngine');
const { buildSnapshot } = require('../automationCenter/repository');

function context(record) {
  return {
    tenantId: record.tenantId,
    sessionId: record.sessionId,
    workspaceGeneration: record.state.generation,
    workspaceRevision: record.revision,
    anchorTime: record.state.createdAt,
  };
}
function project(record) {
  const engineContext = context(record);
  const state = runtime.currentState(record.state.automationJourney, engineContext);
  const evidence = runtime.deriveEvidence(state, engineContext);
  const runRow = runtime.demoEvidenceRow(state, engineContext);
  const records = state.events.map(event => ({
    record_id: event.id,
    run_id: event.runId,
    record_type: event.type,
    // Historical event rows do not carry enough source-version detail to
    // strengthen them to current. Current authority stays on the exact run row.
    currentness_marker: 'captured_not_runtime_revalidated',
    authority_class: ['provider_attempt', 'terminal_outcome'].includes(event.type) ? 'effect_evidence' : 'automation_decision',
    recorded_at: event.at,
  }));
  const channels = [
    { requested_channel_id: 'in_app_passive', capability_state: 'available',
      result_state: 'ready_internal_no_effect', recorded_at: state.virtualNow },
    { requested_channel_id: 'email', capability_state: 'simulation_only',
      result_state: 'simulated_demo_only', recorded_at: state.virtualNow },
    { requested_channel_id: 'sms', capability_state: 'simulation_only',
      result_state: 'simulated_demo_only', recorded_at: state.virtualNow },
  ];
  const stopControl = state.tenantControl === 'active_resumed' ? [] : [{
    control_state: state.tenantControl, control_sequence: 1, queued_count: 0,
    leased_count: 0, uncertain_count: 0, permanent_stop_count: 1, updated_at: state.virtualNow,
  }];
  const snapshot = buildSnapshot({ organizationId: record.tenantId, actorUserId: record.sessionId,
    actorAccessRole: 'owner', authSessionId: record.sessionId }, {
    mode: 'isolated_demo', evaluatedAt: state.virtualNow,
    policies: [{ policy_id: state.policy.id, version: String(state.policy.version),
      source_class_id: runtime.SOURCE_CLASS, action_family: runtime.ACTION_FAMILY,
      channel_id: runtime.CHANNEL_ID, lifecycle_state: evidence.policy.lifecycle,
      lifecycle_currentness: 'exact_current_not_runtime_revalidated', control_state: state.policy.control,
      expires_at: state.policy.expiresAt, recorded_at: state.events[0].at }],
    runs: [runRow], records, documents: [], channels, stopControl,
  });
  return Object.freeze({
    snapshot,
    demo: Object.freeze({
      contract: runtime.CONTRACT,
      generation: state.generation,
      workspaceRevision: record.revision,
      virtualNow: state.virtualNow,
      sourceVersion: state.source.version,
      capturedSourceVersion: state.run.capturedSourceVersion,
      policyVersion: state.policy.version,
      providerMode: runtime.PROVIDER_MODE,
      allowedActions: runtime.allowedActions(state, engineContext),
      zeroEffects: Object.freeze({ recipients: 0, providerCalls: 0, external: 0, financial: 0, money: 0 }),
      disclaimer: 'This is fictional information only. Nothing here changes your account or contacts a real outside service or person.',
    }),
  });
}

module.exports = Object.freeze({ context, project });
