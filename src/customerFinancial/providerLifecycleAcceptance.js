'use strict';

const { types: utilTypes } = require('node:util');
const providerBoundary = require('./paymentProviderBoundary');
const lifecycleRecovery = require('./providerLifecycleRecovery');

const CONTRACT_VERSION = 'm27-provider-lifecycle-acceptance-v1';
const REASON = 'provider_lifecycle_acceptance_unavailable';
const REQUIREMENTS = Object.freeze([
  ['verified_load_and_capacity_bounds', 'load_capacity_evidence_unavailable'],
  ['accepted_abuse_resistance_evidence', 'abuse_resistance_evidence_unavailable'],
  ['accepted_security_review', 'security_review_unavailable'],
  ['tested_disaster_recovery_restore', 'disaster_restore_proof_unavailable'],
  ['independent_whole_part13_acceptance', 'independent_part13_acceptance_unavailable'],
]);
const MAX_DATA_DEPTH = 32;
const MAX_DATA_NODES = 8192;
const OBJECT_PROTOTYPE_KEYS = Object.freeze(Reflect.ownKeys(Object.prototype));
const ARRAY_PROTOTYPE_KEYS = Object.freeze(Reflect.ownKeys(Array.prototype));

function invalidBoundary() {
  return new Error('Provider lifecycle acceptance boundary invalid');
}

function sameOwnKeys(left, right) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function assertStrictPlainData(value) {
  const visited = new Set();
  let nodes = 0;
  function visit(current, depth) {
    nodes += 1;
    if (nodes > MAX_DATA_NODES || depth > MAX_DATA_DEPTH) throw invalidBoundary();
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) throw invalidBoundary();
      return;
    }
    if (typeof current !== 'object' || utilTypes.isProxy(current) || visited.has(current)) {
      throw invalidBoundary();
    }
    visited.add(current);
    const isArray = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    const expectedPrototype = isArray ? Array.prototype : Object.prototype;
    const expectedPrototypeKeys = isArray ? ARRAY_PROTOTYPE_KEYS : OBJECT_PROTOTYPE_KEYS;
    if (prototype !== expectedPrototype ||
        !sameOwnKeys(Reflect.ownKeys(prototype), expectedPrototypeKeys) ||
        'toJSON' in current) throw invalidBoundary();
    const ownKeys = Reflect.ownKeys(current);
    if (ownKeys.some(key => typeof key !== 'string')) throw invalidBoundary();
    if (isArray) {
      if (ownKeys.length !== current.length + 1) throw invalidBoundary();
      const lengthDescriptor = Object.getOwnPropertyDescriptor(current, 'length');
      if (!lengthDescriptor || lengthDescriptor.enumerable ||
          !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')) throw invalidBoundary();
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !descriptor.enumerable ||
            !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw invalidBoundary();
        visit(descriptor.value, depth + 1);
      }
      return;
    }
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !descriptor.enumerable ||
          !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw invalidBoundary();
      visit(descriptor.value, depth + 1);
    }
  }
  visit(value, 0);
}

function sameStrictPlainData(left, right) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' ||
      Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] &&
      sameStrictPlainData(left[key], right[key]));
}

function requirement([name, reason]) {
  return Object.freeze({ requirement: name, state: 'unavailable', reason });
}

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const performance = launch.performance;
  const security = launch.professionalReviews?.security;
  if (JSON.stringify(performance) !== JSON.stringify({
    maximumJsonRequestBytes: 65536,
    maximumProviderEventBytes: 262144,
    maximumPageSize: 100,
    maximumAccountingExportRecords: 1000,
    maximumAccountingExportMinorUnits: '100000000',
    singleControlAccountingExportRecords: 100,
    singleControlAccountingExportMinorUnits: '10000000',
    maximumSynchronousMutationSeconds: 5,
    maximumProviderSessionMinutes: 30,
    webhookClockToleranceSeconds: 300,
    concurrentWriterPerAggregate: 1,
  }) || security?.accepted !== false ||
      JSON.stringify(security?.requiredBefore) !==
        JSON.stringify(['provider_sandbox_acceptance', 'live_payment_launch']) ||
      launch.retention.legalTaxAccountingProviderSecurityReviewComplete !== false ||
      launch.release.oneWriter !== true ||
      launch.release.sameIndependentWholeHeadAuditor !== true ||
      launch.release.maximumAcceptedFindingSeverity !== 'none_p0_through_p3' ||
      launch.release.oneNormalPullRequest !== true ||
      launch.release.oneAutomaticRailwayDeployment !== true ||
      JSON.stringify(launch.release.requiredHttp200Paths) !==
        JSON.stringify(['/api/health', '/', '/demo/']) ||
      launch.rollout.currentStage !== 'disabled' ||
      launch.rollout.serverOwnedTenantFlagDefault !== 'off' ||
      launch.rollout.missionCompletionRequiresProviderSandbox !== true ||
      launch.rollout.missionCompletionRequiresLiveMoneyCanary !== true ||
      launch.rollout.missionCompletionRequiresFounderVisualVerdict !== true ||
      launch.unavailableResponse.olderSourceFallback !== false ||
      launch.unavailableResponse.demoFallback !== false) {
    throw new Error('Provider lifecycle acceptance policy is unavailable');
  }
  return launch;
}

function unavailable(recoveryRaw = lifecycleRecovery.unavailable()) {
  const launch = policy();
  assertStrictPlainData(recoveryRaw);
  const recovery = lifecycleRecovery.project(recoveryRaw);
  assertStrictPlainData(recovery);
  if (!sameStrictPlainData(recoveryRaw, recovery)) throw invalidBoundary();
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable', reason: REASON, value: null,
    sources: Object.freeze([
      Object.freeze({ source: 'part13c_provider_lifecycle_recovery',
        contractVersion: recovery.contractVersion, digest: providerBoundary.digest(recovery) }),
      ...recovery.sources.map(source => Object.freeze({ source: source.source,
        contractVersion: source.contractVersion, digest: source.digest })),
    ]),
    loadAndCapacity: Object.freeze({
      state: 'unavailable', reason: 'load_capacity_evidence_unavailable',
      maximumJsonRequestBytes: launch.performance.maximumJsonRequestBytes,
      maximumProviderEventBytes: launch.performance.maximumProviderEventBytes,
      maximumPageSize: launch.performance.maximumPageSize,
      maximumAccountingExportRecords: launch.performance.maximumAccountingExportRecords,
      maximumAccountingExportMinorUnits: launch.performance.maximumAccountingExportMinorUnits,
      singleControlAccountingExportRecords: launch.performance.singleControlAccountingExportRecords,
      singleControlAccountingExportMinorUnits: launch.performance.singleControlAccountingExportMinorUnits,
      maximumSynchronousMutationSeconds: launch.performance.maximumSynchronousMutationSeconds,
      maximumProviderSessionMinutes: launch.performance.maximumProviderSessionMinutes,
      webhookClockToleranceSeconds: launch.performance.webhookClockToleranceSeconds,
      concurrentWriterPerAggregate: launch.performance.concurrentWriterPerAggregate,
      loadProfileIdentity: null, testEnvironmentIdentity: null, testedAt: null,
      observedMaximumRequestsPerSecond: null, observedP95LatencyMilliseconds: null,
      observedErrorRateBasisPoints: null, loadTestAccepted: false, capacityAccepted: false,
    }),
    abuseResistance: Object.freeze({
      state: 'unavailable', reason: 'abuse_resistance_evidence_unavailable',
      exactTenantAndSessionRequired: true, ownerRoleRequired: true,
      exactCaseInsensitivePathRequired: true, queryFieldsAllowed: false,
      requestBodyAllowed: false, readMethod: 'GET', unsupportedMethodsFailClosed: true,
      getOnlyCors: true, throttleBeforeSourceRead: true, boundedJsonBytes: 65536,
      boundedProviderEventBytes: 262144, boundedPageSize: 100,
      webhookClockToleranceSeconds: 300, concurrentWriterPerAggregate: 1,
      duplicateConsequentialEffectsAllowed: false, missingEvidenceBecomesZero: false,
      delayedEvidenceBecomesFailure: false, olderSourceFallbackAllowed: false,
      testEvidenceDigest: null, denialOfServiceReviewAccepted: false,
      abuseResistanceAccepted: false,
    }),
    securityReview: Object.freeze({
      state: 'unavailable', reason: 'security_review_unavailable',
      accepted: false,
      requiredBefore: Object.freeze([...launch.professionalReviews.security.requiredBefore]),
      reviewIdentity: null, reviewerIdentity: null, reviewedAt: null,
      evidenceDigest: null, providerSandboxAuthorized: false,
      livePaymentAuthorized: false,
    }),
    disasterRecovery: Object.freeze({
      state: 'unavailable', reason: 'disaster_restore_proof_unavailable',
      requiredMigrationSequence: 272, backupIdentity: null, backupDigest: null,
      backupCreatedAt: null, restoreTargetIdentity: null, restoreStartedAt: null,
      restoreCompletedAt: null, recoveryPointObjectiveSeconds: null,
      recoveryTimeObjectiveSeconds: null, restoredMigrationSequence: null,
      restoreEvidenceDigest: null, sourceIntegrityVerified: false,
      restoreTestAccepted: false, productionRestoreAuthorized: false,
    }),
    independentAcceptance: Object.freeze({
      state: 'unavailable', reason: 'independent_part13_acceptance_unavailable',
      oneWriterRequired: launch.release.oneWriter,
      sameIndependentWholeHeadAuditorRequired:
        launch.release.sameIndependentWholeHeadAuditor,
      maximumAcceptedFindingSeverity: launch.release.maximumAcceptedFindingSeverity,
      oneNormalPullRequestRequired: launch.release.oneNormalPullRequest,
      oneAutomaticRailwayDeploymentRequired: launch.release.oneAutomaticRailwayDeployment,
      requiredHttp200Paths: Object.freeze([...launch.release.requiredHttp200Paths]),
      acceptedHead: null, acceptedTree: null, auditorIdentity: null,
      completedAt: null, evidenceDigest: null, auditPerformed: false, accepted: false,
    }),
    missionVerdicts: Object.freeze({
      fullLocal: false, productionDeployedProviderDisabled: false,
      providerSandboxAccepted: false, livePaymentAccepted: false, missionComplete: false,
      providerSandboxRequired: launch.rollout.missionCompletionRequiresProviderSandbox,
      liveMoneyCanaryRequired: launch.rollout.missionCompletionRequiresLiveMoneyCanary,
      founderVisualVerdictRequired: launch.rollout.missionCompletionRequiresFounderVisualVerdict,
    }),
    requirements: Object.freeze(REQUIREMENTS.map(requirement)),
    privacy: Object.freeze({
      organizationIdentityReturned: false, actorIdentityReturned: false,
      sessionIdentityReturned: false, customerIdentityReturned: false,
      providerAccountIdentityReturned: false, providerCredentialReferenceReturned: false,
      providerEventIdentityReturned: false, requestOrReceiptIdentityReturned: false,
      backupOrRestoreIdentityReturned: false, auditorIdentityReturned: false,
      rawPayloadReturned: false, secretValueReturned: false,
    }),
    loadTestAuthorized: false, abuseTestAuthorized: false,
    securityReviewAccepted: false, disasterRestoreAuthorized: false,
    independentPart13Accepted: false, providerCallCount: 0,
    providerMutationCount: 0, receiverMutationCount: 0,
    accountingMutationCount: 0, databaseMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw, recoveryRaw = lifecycleRecovery.unavailable()) {
  assertStrictPlainData(raw);
  const expected = unavailable(recoveryRaw);
  assertStrictPlainData(expected);
  if (!sameStrictPlainData(raw, expected)) throw invalidBoundary();
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, REQUIREMENTS, policy, unavailable, project };
