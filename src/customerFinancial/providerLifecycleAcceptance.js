'use strict';

const vm = require('node:vm');
const { types: utilTypes } = require('node:util');

// This validator is private to this module. It is created before any Part 13
// dependency is imported and cannot be replaced through a forged CommonJS
// module record. Every intrinsic used to inspect the host realm comes from the
// fresh realm; ambient Object static methods are never part of the bootstrap.
const privatePlainData = vm.runInNewContext(`(() => {
  const ownKeys = Reflect.ownKeys;
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const getPrototypeOf = Object.getPrototypeOf;
  const arrayIsArray = Array.isArray;
  const numberIsFinite = Number.isFinite;
  const objectIs = Object.is;
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const functionSource = value => Function.prototype.toString.call(value);
  const hostObjectPrototype = getPrototypeOf(hostObjectSample);
  const hostArrayPrototype = getPrototypeOf(hostArraySample);
  const jestHarnessSymbol = Symbol.for('$$jest-protect-from-deletion');

  function sameFunction(actual, expected) {
    if (typeof actual !== 'function' || isProxy(actual)) return false;
    try { return functionSource(actual) === functionSource(expected); }
    catch (_error) { return false; }
  }
  function sameFunctionOrUndefined(actual, expected) {
    return expected === undefined ? actual === undefined : sameFunction(actual, expected);
  }
  function sameValue(actual, expected, depth, seen, allowedHarnessSymbol) {
    if (objectIs(actual, expected)) return true;
    if (typeof expected === 'function') return sameFunction(actual, expected);
    if (expected === null || typeof expected !== 'object' ||
        actual === null || typeof actual !== 'object' || isProxy(actual) || depth > 8) {
      return false;
    }
    return sameObjectShape(actual, expected, depth + 1, seen, allowedHarnessSymbol);
  }
  function sameDescriptor(actual, expected, depth, seen, allowedHarnessSymbol) {
    if (!actual || !expected || actual.enumerable !== expected.enumerable ||
        actual.configurable !== expected.configurable) return false;
    const actualData = hasOwn(actual, 'value');
    const expectedData = hasOwn(expected, 'value');
    if (actualData !== expectedData) return false;
    if (actualData) {
      return actual.writable === expected.writable &&
        sameValue(actual.value, expected.value, depth, seen, allowedHarnessSymbol);
    }
    return sameFunctionOrUndefined(actual.get, expected.get) &&
      sameFunctionOrUndefined(actual.set, expected.set);
  }
  function sameObjectShape(actual, expected, depth, seen, allowedHarnessSymbol) {
    if (isProxy(actual) || seen.has(actual)) return false;
    seen.add(actual);
    let actualKeys = ownKeys(actual);
    const expectedKeys = ownKeys(expected);
    if (expected === Object.prototype && allowedHarnessSymbol !== null) {
      const withoutHarnessMarker = [];
      for (let index = 0; index < actualKeys.length; index += 1) {
        if (actualKeys[index] !== allowedHarnessSymbol) withoutHarnessMarker.push(actualKeys[index]);
      }
      actualKeys = withoutHarnessMarker;
    }
    if (actualKeys.length !== expectedKeys.length) return false;
    for (let index = 0; index < expectedKeys.length; index += 1) {
      if (actualKeys[index] !== expectedKeys[index] ||
          !sameDescriptor(getOwnPropertyDescriptor(actual, actualKeys[index]),
            getOwnPropertyDescriptor(expected, expectedKeys[index]), depth, seen,
            allowedHarnessSymbol)) return false;
    }
    const actualPrototype = getPrototypeOf(actual);
    const expectedPrototype = getPrototypeOf(expected);
    if (actualPrototype === null || expectedPrototype === null) {
      return actualPrototype === null && expectedPrototype === null;
    }
    return sameObjectShape(actualPrototype, expectedPrototype, depth + 1, seen,
      allowedHarnessSymbol);
  }
  function acceptedJestHarnessSymbol() {
    if (!isTest || !hasJestWorker) return null;
    const descriptor = getOwnPropertyDescriptor(hostObjectPrototype, jestHarnessSymbol);
    if (!descriptor || descriptor.enumerable || !descriptor.configurable ||
        !descriptor.writable || !hasOwn(descriptor, 'value') ||
        isProxy(descriptor.value) || !arrayIsArray(descriptor.value)) return null;
    const markerKeys = ownKeys(descriptor.value);
    const length = getOwnPropertyDescriptor(descriptor.value, 'length');
    if (markerKeys.length !== 1 || markerKeys[0] !== 'length' || !length ||
        length.value !== 0) return null;
    return jestHarnessSymbol;
  }
  function invalid() {
    return new Error('Provider lifecycle acceptance boundary invalid');
  }
  function assertCanonicalAmbientPrototypes() {
    const allowedHarnessSymbol = acceptedJestHarnessSymbol();
    if (!sameObjectShape(hostObjectPrototype, Object.prototype, 0, new Set(),
      allowedHarnessSymbol) ||
        !sameObjectShape(hostArrayPrototype, Array.prototype, 0, new Set(),
          allowedHarnessSymbol)) throw invalid();
  }
  function assertStrictPlainData(value, invalidFactory, maximumDepth = 32,
      maximumNodes = 8192) {
    assertCanonicalAmbientPrototypes();
    const rejectWith = typeof invalidFactory === 'function' ? invalidFactory : invalid;
    const visited = new Set();
    let nodes = 0;
    function reject() { throw rejectWith(); }
    function visit(current, depth) {
      nodes += 1;
      if (nodes > maximumNodes || depth > maximumDepth) reject();
      if (current === null || typeof current === 'string' ||
          typeof current === 'boolean') return;
      if (typeof current === 'number') {
        if (!numberIsFinite(current) || objectIs(current, -0)) reject();
        return;
      }
      if (typeof current !== 'object' || isProxy(current) || visited.has(current)) reject();
      visited.add(current);
      const isArray = arrayIsArray(current);
      const prototype = getPrototypeOf(current);
      const expectedPrototype = isArray ? hostArrayPrototype : hostObjectPrototype;
      if (prototype !== expectedPrototype ||
          !sameObjectShape(prototype, isArray ? Array.prototype : Object.prototype,
            0, new Set(), acceptedJestHarnessSymbol()) ||
          getOwnPropertyDescriptor(current, 'toJSON')) reject();
      const keys = ownKeys(current);
      for (let index = 0; index < keys.length; index += 1) {
        if (typeof keys[index] !== 'string') reject();
      }
      if (isArray) {
        const lengthDescriptor = getOwnPropertyDescriptor(current, 'length');
        if (!lengthDescriptor || lengthDescriptor.enumerable ||
            !hasOwn(lengthDescriptor, 'value') ||
            keys.length !== lengthDescriptor.value + 1 ||
            typeof lengthDescriptor.value !== 'number') reject();
        for (let index = 0; index < lengthDescriptor.value; index += 1) {
          const descriptor = getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) reject();
          visit(descriptor.value, depth + 1);
        }
        return;
      }
      for (let index = 0; index < keys.length; index += 1) {
        const descriptor = getOwnPropertyDescriptor(current, keys[index]);
        if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) reject();
        visit(descriptor.value, depth + 1);
      }
    }
    visit(value, 0);
  }
  function sameStrictPlainData(left, right) {
    assertCanonicalAmbientPrototypes();
    function same(leftValue, rightValue) {
      if (objectIs(leftValue, rightValue)) return true;
      if (leftValue === null || rightValue === null ||
          typeof leftValue !== 'object' || typeof rightValue !== 'object' ||
          arrayIsArray(leftValue) !== arrayIsArray(rightValue)) return false;
      const leftKeys = ownKeys(leftValue);
      const rightKeys = ownKeys(rightValue);
      if (leftKeys.length !== rightKeys.length) return false;
      for (let index = 0; index < leftKeys.length; index += 1) {
        if (leftKeys[index] !== rightKeys[index]) return false;
        const leftDescriptor = getOwnPropertyDescriptor(leftValue, leftKeys[index]);
        const rightDescriptor = getOwnPropertyDescriptor(rightValue, rightKeys[index]);
        if (!leftDescriptor || !rightDescriptor || !hasOwn(leftDescriptor, 'value') ||
            !hasOwn(rightDescriptor, 'value') ||
            !same(leftDescriptor.value, rightDescriptor.value)) return false;
      }
      return true;
    }
    return same(left, right);
  }
  assertCanonicalAmbientPrototypes();
  return Object.freeze({ assertCanonicalAmbientPrototypes,
    assertStrictPlainData, sameStrictPlainData, freeze: Object.freeze });
})()`, { __proto__: null, hostObjectSample: {}, hostArraySample: [],
  isProxy: utilTypes.isProxy, isTest: process.env.NODE_ENV === 'test',
  hasJestWorker: !!process.env.JEST_WORKER_ID });
const { assertCanonicalAmbientPrototypes, assertStrictPlainData,
  sameStrictPlainData, freeze } = privatePlainData;

function invalidBoundary() {
  return new Error('Provider lifecycle acceptance boundary invalid');
}

// This check deliberately precedes every upstream Part13 import. Ambient
// prototype pollution must fail before a default builder, digest, serializer,
// or projection from a sealed earlier slice can execute.
assertCanonicalAmbientPrototypes();

const providerBoundary = require('./paymentProviderBoundary');
const lifecycleRecovery = require('./providerLifecycleRecovery');

const CONTRACT_VERSION = 'm27-provider-lifecycle-acceptance-v1';
const REASON = 'provider_lifecycle_acceptance_unavailable';
const REQUIREMENTS = freeze([
  ['verified_load_and_capacity_bounds', 'load_capacity_evidence_unavailable'],
  ['accepted_abuse_resistance_evidence', 'abuse_resistance_evidence_unavailable'],
  ['accepted_security_review', 'security_review_unavailable'],
  ['tested_disaster_recovery_restore', 'disaster_restore_proof_unavailable'],
  ['independent_whole_part13_acceptance', 'independent_part13_acceptance_unavailable'],
]);
function requirement([name, reason]) {
  return freeze({ requirement: name, state: 'unavailable', reason });
}

function policy() {
  assertCanonicalAmbientPrototypes();
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

function unavailable(recoveryRaw) {
  assertCanonicalAmbientPrototypes();
  if (recoveryRaw === undefined) recoveryRaw = lifecycleRecovery.unavailable();
  assertStrictPlainData(recoveryRaw, invalidBoundary);
  const recovery = lifecycleRecovery.project(recoveryRaw);
  assertStrictPlainData(recovery, invalidBoundary);
  if (!sameStrictPlainData(recoveryRaw, recovery)) throw invalidBoundary();
  const launch = policy();
  return freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable', reason: REASON, value: null,
    sources: freeze([
      freeze({ source: 'part13c_provider_lifecycle_recovery',
        contractVersion: recovery.contractVersion, digest: providerBoundary.digest(recovery) }),
      ...recovery.sources.map(source => freeze({ source: source.source,
        contractVersion: source.contractVersion, digest: source.digest })),
    ]),
    loadAndCapacity: freeze({
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
    abuseResistance: freeze({
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
    securityReview: freeze({
      state: 'unavailable', reason: 'security_review_unavailable',
      accepted: false,
      requiredBefore: freeze([...launch.professionalReviews.security.requiredBefore]),
      reviewIdentity: null, reviewerIdentity: null, reviewedAt: null,
      evidenceDigest: null, providerSandboxAuthorized: false,
      livePaymentAuthorized: false,
    }),
    disasterRecovery: freeze({
      state: 'unavailable', reason: 'disaster_restore_proof_unavailable',
      requiredMigrationSequence: 272, backupIdentity: null, backupDigest: null,
      backupCreatedAt: null, restoreTargetIdentity: null, restoreStartedAt: null,
      restoreCompletedAt: null, recoveryPointObjectiveSeconds: null,
      recoveryTimeObjectiveSeconds: null, restoredMigrationSequence: null,
      restoreEvidenceDigest: null, sourceIntegrityVerified: false,
      restoreTestAccepted: false, productionRestoreAuthorized: false,
    }),
    independentAcceptance: freeze({
      state: 'unavailable', reason: 'independent_part13_acceptance_unavailable',
      oneWriterRequired: launch.release.oneWriter,
      sameIndependentWholeHeadAuditorRequired:
        launch.release.sameIndependentWholeHeadAuditor,
      maximumAcceptedFindingSeverity: launch.release.maximumAcceptedFindingSeverity,
      oneNormalPullRequestRequired: launch.release.oneNormalPullRequest,
      oneAutomaticRailwayDeploymentRequired: launch.release.oneAutomaticRailwayDeployment,
      requiredHttp200Paths: freeze([...launch.release.requiredHttp200Paths]),
      acceptedHead: null, acceptedTree: null, auditorIdentity: null,
      completedAt: null, evidenceDigest: null, auditPerformed: false, accepted: false,
    }),
    missionVerdicts: freeze({
      fullLocal: false, productionDeployedProviderDisabled: false,
      providerSandboxAccepted: false, livePaymentAccepted: false, missionComplete: false,
      providerSandboxRequired: launch.rollout.missionCompletionRequiresProviderSandbox,
      liveMoneyCanaryRequired: launch.rollout.missionCompletionRequiresLiveMoneyCanary,
      founderVisualVerdictRequired: launch.rollout.missionCompletionRequiresFounderVisualVerdict,
    }),
    requirements: freeze(REQUIREMENTS.map(requirement)),
    privacy: freeze({
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

function project(raw, recoveryRaw) {
  assertCanonicalAmbientPrototypes();
  if (recoveryRaw === undefined) recoveryRaw = lifecycleRecovery.unavailable();
  assertStrictPlainData(raw, invalidBoundary);
  const expected = unavailable(recoveryRaw);
  assertStrictPlainData(expected, invalidBoundary);
  if (!sameStrictPlainData(raw, expected)) throw invalidBoundary();
  return expected;
}

module.exports = freeze({ CONTRACT_VERSION, REASON, REQUIREMENTS, policy, unavailable, project });
