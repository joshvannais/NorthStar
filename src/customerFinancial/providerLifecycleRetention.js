'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const lifecycleHealth = require('./providerLifecycleHealth');

const CONTRACT_VERSION = 'm27-provider-lifecycle-retention-v1';
const REASON = 'retention_deletion_authority_unavailable';
const DELETE_CAPABILITY = 'customer_financial.record.delete';
const REQUIREMENTS = Object.freeze([
  ['exact_current_provider_lifecycle', 'provider_lifecycle_authority_unavailable'],
  ['bounded_durable_cleanup_checkpoint', 'retention_checkpoint_authority_unavailable'],
  ['exact_provider_event_replay_disposition', 'provider_event_receipt_unavailable'],
  ['accepted_retention_launch_review', 'retention_review_unavailable'],
  ['exact_deletion_scope_and_dual_control', 'record_deletion_authority_unavailable'],
  ['server_owned_recent_authentication_fact', 'recent_auth_required'],
  ['accepted_mfa_ceremony', 'mfa_required'],
  ['current_legal_audit_and_dispute_holds', 'retention_hold_authority_unavailable'],
  ['resumable_cleanup_receipt', 'retention_cleanup_authority_unavailable'],
  ['minimized_non_sensitive_tombstone', 'retention_tombstone_authority_unavailable'],
]);

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const retention = launch.retention;
  const deletion = launch.actionControl[DELETE_CAPABILITY];
  if (retention.rawQuotedJobMediaDays !== 30 ||
      retention.rawProviderEventDays !== 30 ||
      retention.publicSessionTombstoneDays !== 30 ||
      retention.financialRecordCalendarYears !== 7 ||
      retention.immutableIdempotencyAndAuditCalendarYears !== 7 ||
      retention.legalTaxAccountingProviderSecurityReviewComplete !== false ||
      retention.holdsSuspendEligibleDeletion !== true ||
      retention.rawTranscriptCopiedIntoMission27 !== false ||
      launch.financial.dispute.blocksDestructiveCleanup !== true ||
      launch.professionalReviews.legal.accepted !== false ||
      !launch.professionalReviews.legal.requiredBefore.includes('retention_launch') ||
      launch.professionalReviews.provider.accepted !== false ||
      launch.professionalReviews.security.accepted !== false ||
      launch.performance.maximumPageSize !== 100 ||
      launch.performance.concurrentWriterPerAggregate !== 1 ||
      launch.performance.webhookClockToleranceSeconds !== 300 ||
      launch.team.recentAuthSeconds !== 600 || launch.team.mfaFreshnessSeconds !== 600 ||
      deletion?.mode !== 'dual_control' || deletion?.singleControlAllowed !== false ||
      JSON.stringify(deletion?.requires) !== JSON.stringify([
        'two_different_current_humans', 'exact_deletion_scope_and_digest',
        'current_retention_and_hold_state', 'reason',
      ]) || launch.unavailableResponse.olderSourceFallback !== false) {
    throw new Error('Provider lifecycle retention policy is unavailable');
  }
  return launch;
}

function requirement([name, reason]) {
  return Object.freeze({ requirement: name, state: 'unavailable', reason });
}

function unavailable(healthRaw = lifecycleHealth.unavailable()) {
  const launch = policy();
  const health = lifecycleHealth.project(healthRaw);
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sources: Object.freeze([
      Object.freeze({
        source: 'part13a_provider_lifecycle_health',
        contractVersion: health.contractVersion,
        digest: providerBoundary.digest(health),
      }),
      Object.freeze({
        source: 'part8a_provider_event_receipt',
        contractVersion: health.webhookLifecycle.providerEventReceiptVersion,
        digest: health.webhookLifecycle.providerEventReceiptDigest,
      }),
    ]),
    access: Object.freeze({
      eligibleAccessRoles: Object.freeze(['owner']),
      roleAloneAuthorizesDeletion: false,
      deletionCapability: DELETE_CAPABILITY,
      deletionControlMode: launch.actionControl[DELETE_CAPABILITY].mode,
      twoDifferentCurrentHumansRequired: true,
      exactDeletionScopeAndDigestRequired: true,
      currentRetentionAndHoldStateRequired: true,
      immutableReasonRequired: true,
      requiredAssurance: 'recent_auth_mfa',
      maximumRecentAuthenticationSeconds: launch.team.recentAuthSeconds,
      maximumMfaFreshnessSeconds: launch.team.mfaFreshnessSeconds,
      recentAuthenticationState: 'unavailable',
      mfaState: 'unavailable',
      selfApprovalAllowed: false,
      callerSuppliedCheckpointAccepted: false,
      callerSuppliedRetentionOrHoldStateAccepted: false,
    }),
    checkpoints: Object.freeze({
      state: 'unavailable',
      reason: 'retention_checkpoint_authority_unavailable',
      maximumPageSize: launch.performance.maximumPageSize,
      concurrentWriterPerAggregate: launch.performance.concurrentWriterPerAggregate,
      checkpointIdentity: null,
      checkpointDigest: null,
      cursor: null,
      lastProcessedIdentity: null,
      sourceHighWater: null,
      persisted: false,
      exactCurrent: false,
      mayAuthorizeReplayOrDeletion: false,
    }),
    replayWindow: Object.freeze({
      state: 'unavailable',
      reason: 'provider_event_receipt_unavailable',
      webhookClockToleranceSeconds: launch.performance.webhookClockToleranceSeconds,
      rawProviderEventDays: launch.retention.rawProviderEventDays,
      uniqueProviderEventIdentityRequired: true,
      exactProviderAccountAndModeRequired: true,
      replayWindowEvaluated: false,
      replayDetected: false,
      replayAccepted: false,
      replaySafeAcknowledgementAvailable: false,
      olderSourceFallbackAllowed: false,
    }),
    retention: Object.freeze({
      state: 'unavailable',
      reason: 'retention_review_unavailable',
      rawQuotedJobMediaDays: launch.retention.rawQuotedJobMediaDays,
      rawProviderEventDays: launch.retention.rawProviderEventDays,
      publicSessionTombstoneDays: launch.retention.publicSessionTombstoneDays,
      financialRecordCalendarYears: launch.retention.financialRecordCalendarYears,
      immutableIdempotencyAndAuditCalendarYears:
        launch.retention.immutableIdempotencyAndAuditCalendarYears,
      policyReviewComplete: launch.retention.legalTaxAccountingProviderSecurityReviewComplete,
      rawTranscriptCopiedIntoMission27: launch.retention.rawTranscriptCopiedIntoMission27,
      retentionLaunchAuthorized: false,
      providerPayloadRetentionStarted: false,
      financialRecordDeletionEligible: false,
      idempotencyOrAuditDeletionEligible: false,
      eligibilityEvaluatedAt: null,
      retentionExpiresAt: null,
    }),
    deletionRequest: Object.freeze({
      state: 'unavailable',
      reason: 'record_deletion_authority_unavailable',
      requestIdentity: null,
      scope: null,
      scopeDigest: null,
      requestedAt: null,
      firstApproverIdentity: null,
      secondApproverIdentity: null,
      retentionAndHoldStateDigest: null,
      immutableReason: null,
      dualControlSatisfied: false,
      authorized: false,
      executed: false,
      providerDeletionRequested: false,
      deletedRecordCount: 0,
    }),
    holds: Object.freeze({
      state: 'unavailable',
      reason: 'retention_hold_authority_unavailable',
      holdsSuspendEligibleDeletion: launch.retention.holdsSuspendEligibleDeletion,
      disputeBlocksDestructiveCleanup: launch.financial.dispute.blocksDestructiveCleanup,
      legalHoldState: 'unavailable',
      auditHoldState: 'unavailable',
      disputeHoldState: 'unavailable',
      refundHoldState: 'unavailable',
      holdIdentity: null,
      holdScopeDigest: null,
      evaluatedAt: null,
      unknownHoldStateBlocksDestructiveCleanup: true,
      refundHoldBlocksDestructiveCleanup: true,
      destructiveCleanupAuthorized: false,
    }),
    cleanup: Object.freeze({
      state: 'unavailable',
      reason: 'retention_cleanup_authority_unavailable',
      resumableCleanupRequired: true,
      maximumBatchSize: launch.performance.maximumPageSize,
      checkpointIdentity: null,
      attemptIdentity: null,
      sourceDigest: null,
      startedAt: null,
      resumedAt: null,
      completedAt: null,
      processedCount: 0,
      deletedCount: 0,
      failedCount: 0,
      retryCount: 0,
      resumeAuthorized: false,
      completed: false,
    }),
    tombstone: Object.freeze({
      state: 'unavailable',
      reason: 'retention_tombstone_authority_unavailable',
      minimizedNonSensitiveProofRequired: true,
      publicSessionTombstoneDays: launch.retention.publicSessionTombstoneDays,
      tombstoneIdentity: null,
      deletionReceiptDigest: null,
      retainedFieldNames: null,
      customerIdentityRetained: false,
      providerAccountIdentityRetained: false,
      paymentInstrumentRetained: false,
      providerPayloadRetained: false,
      rawSecretRetained: false,
      tombstoneWritten: false,
      tombstoneCount: 0,
    }),
    requirements: Object.freeze(REQUIREMENTS.map(requirement)),
    privacy: Object.freeze({
      organizationIdentityReturned: false,
      actorIdentityReturned: false,
      sessionIdentityReturned: false,
      customerIdentityReturned: false,
      providerAccountIdentityReturned: false,
      providerEventIdentityReturned: false,
      deletionScopeReturned: false,
      holdIdentityReturned: false,
      checkpointIdentityReturned: false,
      secretValueReturned: false,
    }),
    checkpointWriteAuthorized: false,
    replayAuthorized: false,
    retentionStarted: false,
    deletionRequestAuthorized: false,
    holdMutationAuthorized: false,
    cleanupAuthorized: false,
    tombstoneWriteAuthorized: false,
    providerCallCount: 0,
    providerMutationCount: 0,
    receiverMutationCount: 0,
    accountingMutationCount: 0,
    databaseMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw, healthRaw = lifecycleHealth.unavailable()) {
  const expected = unavailable(healthRaw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Provider lifecycle retention boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, DELETE_CAPABILITY, REQUIREMENTS,
  policy, unavailable, project };
