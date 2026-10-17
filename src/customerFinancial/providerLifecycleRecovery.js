'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const lifecycleHealth = require('./providerLifecycleHealth');
const lifecycleRetention = require('./providerLifecycleRetention');

const CONTRACT_VERSION = 'm27-provider-lifecycle-recovery-v1';
const REASON = 'provider_operational_recovery_authority_unavailable';
const RECOVERY_CAPABILITY = 'customer_financial.record.recover';
const REQUIREMENTS = Object.freeze([
  ['verified_migration_and_restart_state', 'migration_restart_evidence_unavailable'],
  ['single_writer_concurrency_fence', 'concurrency_execution_authority_unavailable'],
  ['tested_provider_failover_target', 'provider_failover_authority_unavailable'],
  ['exact_uncertain_result_receipt', 'uncertain_result_receipt_unavailable'],
  ['current_provider_outage_observation', 'provider_outage_observation_unavailable'],
  ['bounded_durable_queue_and_backpressure', 'provider_queue_authority_unavailable'],
  ['minimized_operational_observability', 'provider_observability_unavailable'],
  ['reviewed_alert_destination_and_policy', 'provider_alert_authority_unavailable'],
  ['versioned_reviewed_recovery_runbook', 'provider_recovery_runbook_unavailable'],
]);

function requirement([name, reason]) {
  return Object.freeze({ requirement: name, state: 'unavailable', reason });
}

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const recovery = launch.actionControl?.[RECOVERY_CAPABILITY];
  if (launch.performance.maximumPageSize !== 100 ||
      launch.performance.maximumSynchronousMutationSeconds !== 5 ||
      launch.performance.concurrentWriterPerAggregate !== 1 ||
      recovery?.mode !== 'conditional_dual_control' ||
      JSON.stringify(recovery?.singleControlAllowedWhen) !== JSON.stringify([
        'read_only_receipt_lookup', 'no_external_effect', 'no_financial_effect',
        'exact_original_request_and_receipt',
      ]) || JSON.stringify(recovery?.dualControlRequiredWhen) !== JSON.stringify([
        'may_create_or_restore_external_effect', 'may_create_or_restore_financial_effect',
      ]) || JSON.stringify(recovery?.denyWhen) !== JSON.stringify([
        'effect_classification_missing', 'exact_original_request_or_receipt_missing',
        'any_required_authority_identity_or_currentness_condition_missing',
      ]) || recovery?.effectMayExceedOriginalRequest !== false ||
      launch.rollout.currentStage !== 'disabled' ||
      launch.rollout.serverOwnedTenantFlagDefault !== 'off' ||
      launch.unavailableResponse.olderSourceFallback !== false) {
    throw new Error('Provider lifecycle recovery policy is unavailable');
  }
  return launch;
}

function unavailable(retentionRaw = lifecycleRetention.unavailable()) {
  const launch = policy();
  const retention = lifecycleRetention.project(retentionRaw);
  const part13a = retention.sources[0];
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sources: Object.freeze([
      Object.freeze({ source: 'part13b_provider_lifecycle_retention',
        contractVersion: retention.contractVersion,
        digest: providerBoundary.digest(retention) }),
      Object.freeze({ source: part13a.source, contractVersion: part13a.contractVersion,
        digest: part13a.digest }),
    ]),
    migrationAndRestart: Object.freeze({
      state: 'unavailable',
      reason: 'migration_restart_evidence_unavailable',
      requiredMigrationSequence: 272,
      laterMigrationExpected: false,
      migrationVerifiedAt: null,
      restartVerifiedAt: null,
      startupIdentity: null,
      exactSchemaCurrent: false,
      restartRecoveryComplete: false,
      previousVersionFallbackAllowed: false,
    }),
    concurrency: Object.freeze({
      state: 'unavailable',
      reason: 'concurrency_execution_authority_unavailable',
      concurrentWriterPerAggregate: launch.performance.concurrentWriterPerAggregate,
      exactAggregateIdentityRequired: true,
      exactRequestDigestRequired: true,
      serializeDuplicateRequests: true,
      changedReuseConflicts: true,
      inFlightWriterIdentity: null,
      fenceReceiptDigest: null,
      executionVerified: false,
    }),
    failover: Object.freeze({
      state: 'unavailable',
      reason: 'provider_failover_authority_unavailable',
      providerFailoverTarget: null,
      failoverMode: null,
      targetAccountIdentity: null,
      targetCredentialReference: null,
      testedAt: null,
      automaticFailoverAuthorized: false,
      crossAccountReplayAuthorized: false,
      crossModeReplayAuthorized: false,
      completed: false,
    }),
    uncertainResultRecovery: Object.freeze({
      state: 'unavailable',
      reason: 'uncertain_result_receipt_unavailable',
      requiredCapability: RECOVERY_CAPABILITY,
      controlMode: launch.actionControl[RECOVERY_CAPABILITY].mode,
      readOnlyReceiptLookupSingleControlAllowed: true,
      effectRecoveryRequiresDualControl: true,
      exactOriginalRequestAndReceiptRequired: true,
      exactOriginalAmountAndScopeRequired: true,
      receiptLookupBeforeRetryRequired: true,
      effectMayExceedOriginalRequest: false,
      receiptIdentity: null,
      receiptDigest: null,
      originalRequestDigest: null,
      lookupComplete: false,
      retryAuthorized: false,
      recovered: false,
    }),
    providerOutage: Object.freeze({
      state: 'unavailable',
      reason: 'provider_outage_observation_unavailable',
      degradedStateVocabulary: Object.freeze(['unavailable', 'pending']),
      currentDegradedState: 'unavailable',
      observedProviderState: null,
      observedAt: null,
      delayedEvidenceRemainsPending: true,
      delayedEvidenceBecomesFailure: false,
      missingEvidenceBecomesZero: false,
      successMayBeFabricated: false,
      consequentialAutomaticRetryAuthorized: false,
      newProviderActionAuthorized: false,
      acceptedPendingEvidenceAvailable: false,
    }),
    queueAndBackpressure: Object.freeze({
      state: 'unavailable',
      reason: 'provider_queue_authority_unavailable',
      maximumBatchSize: launch.performance.maximumPageSize,
      maximumSynchronousMutationSeconds: launch.performance.maximumSynchronousMutationSeconds,
      queueIdentity: null,
      queueDepth: null,
      oldestItemAgeSeconds: null,
      highWaterMark: null,
      backpressureState: 'unavailable',
      durableQueueAvailable: false,
      enqueueAuthorized: false,
      dequeueAuthorized: false,
      backpressureRefusesUnacceptedNewWork: true,
      backpressureDropsAcceptedWork: false,
      droppedItemCount: 0,
    }),
    observability: Object.freeze({
      state: 'unavailable',
      reason: 'provider_observability_unavailable',
      metricContractVersion: null,
      traceContractVersion: null,
      dashboardIdentity: null,
      lastHeartbeatAt: null,
      providerSuccessCount: null,
      providerFailureCount: null,
      uncertainResultCount: null,
      queueDepth: null,
      sensitivePayloadLoggingAllowed: false,
      customerIdentityLoggingAllowed: false,
      providerSecretLoggingAllowed: false,
      operationalEvidenceAccepted: false,
    }),
    alerts: Object.freeze({
      state: 'unavailable',
      reason: 'provider_alert_authority_unavailable',
      alertPolicyVersion: null,
      receiverIdentity: null,
      severity: null,
      lastAlertAt: null,
      acknowledgementIdentity: null,
      deliveryEvidenceDigest: null,
      alertingAuthorized: false,
      receiverMutationAuthorized: false,
      acknowledged: false,
    }),
    runbook: Object.freeze({
      state: 'unavailable',
      reason: 'provider_recovery_runbook_unavailable',
      runbookIdentity: null,
      runbookVersion: null,
      runbookDigest: null,
      reviewedAt: null,
      reviewerIdentity: null,
      testedAt: null,
      rollbackProcedureAccepted: false,
      outageProcedureAccepted: false,
      uncertainResultProcedureAccepted: false,
      operatorAcknowledged: false,
    }),
    requirements: Object.freeze(REQUIREMENTS.map(requirement)),
    privacy: Object.freeze({
      organizationIdentityReturned: false,
      actorIdentityReturned: false,
      sessionIdentityReturned: false,
      customerIdentityReturned: false,
      providerAccountIdentityReturned: false,
      providerCredentialReferenceReturned: false,
      providerEventIdentityReturned: false,
      requestOrReceiptIdentityReturned: false,
      queueIdentityReturned: false,
      alertReceiverIdentityReturned: false,
      rawPayloadReturned: false,
      secretValueReturned: false,
    }),
    migrationAuthorized: false,
    failoverAuthorized: false,
    recoveryAuthorized: false,
    queueMutationAuthorized: false,
    alertMutationAuthorized: false,
    providerCallCount: 0,
    providerMutationCount: 0,
    receiverMutationCount: 0,
    accountingMutationCount: 0,
    databaseMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw, retentionRaw = lifecycleRetention.unavailable()) {
  const expected = unavailable(retentionRaw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Provider lifecycle recovery boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, RECOVERY_CAPABILITY, REQUIREMENTS,
  policy, unavailable, project };
