'use strict';

function bootstrapInvalid() {
  throw new Error('Provider lifecycle acceptance boundary invalid');
}

// Practical trust boundary: NorthStar assumes the standard ECMAScript
// reflection intrinsics and node:util proxy detector provided by the supported
// Node process have not been replaced before application bootstrap. JavaScript
// cannot prove that arbitrary same-process mutation did not already replace
// those primitives. Everything above that boundary is checked against a fixed
// manifest; process.binding, node:vm and source-text self-attestation are not
// trusted or used.
function captureBoundaryRuntime() {
  const ownKeys = Reflect.ownKeys;
  const descriptorOf = Reflect.getOwnPropertyDescriptor;
  const getPrototypeOf = Reflect.getPrototypeOf;
  const defineProperty = Reflect.defineProperty;
  const preventExtensions = Reflect.preventExtensions;
  const reflectApply = Reflect.apply;
  const functionToString = Function.prototype.toString;
  const arrayIsArray = Array.isArray;
  const numberIsFinite = Number.isFinite;
  const objectIs = Object.is;
  const hostObjectPrototype = Object.prototype;
  const hostArrayPrototype = Array.prototype;
  const jestHarnessSymbol = Symbol.for('$$jest-protect-from-deletion');
  const objectFunctions = [
    ['constructor', 'Object'], ['__defineGetter__', '__defineGetter__'],
    ['__defineSetter__', '__defineSetter__'], ['hasOwnProperty', 'hasOwnProperty'],
    ['__lookupGetter__', '__lookupGetter__'], ['__lookupSetter__', '__lookupSetter__'],
    ['isPrototypeOf', 'isPrototypeOf'], ['propertyIsEnumerable', 'propertyIsEnumerable'],
    ['toString', 'toString'], ['valueOf', 'valueOf'],
    ['toLocaleString', 'toLocaleString'],
  ];
  const arrayFunctionNames = [
    'constructor', 'at', 'concat', 'copyWithin', 'fill', 'find', 'findIndex',
    'findLast', 'findLastIndex', 'lastIndexOf', 'pop', 'push', 'reverse', 'shift',
    'unshift', 'slice', 'sort', 'splice', 'includes', 'indexOf', 'join', 'keys',
    'entries', 'values', 'forEach', 'filter', 'flat', 'flatMap', 'map', 'every',
    'some', 'reduce', 'reduceRight', 'toReversed', 'toSorted', 'toSpliced', 'with',
    'toLocaleString', 'toString',
  ];
  const unscopableNames = [
    'at', 'copyWithin', 'entries', 'fill', 'find', 'findIndex', 'findLast',
    'findLastIndex', 'flat', 'flatMap', 'includes', 'keys', 'toReversed',
    'toSorted', 'toSpliced', 'values',
  ];

  function hasOwn(value, key) { return descriptorOf(value, key) !== undefined; }
  function sourceOf(value) { return reflectApply(functionToString, value, []); }
  function nativeSource(name) { return `function ${name}() { [native code] }`; }
  function nativeDataDescriptor(value, expectedName) {
    const descriptor = descriptorOf(value.owner, value.key);
    return Boolean(descriptor && descriptor.enumerable === false &&
      descriptor.configurable === true && descriptor.writable === true &&
      typeof descriptor.value === 'function' &&
      sourceOf(descriptor.value) === nativeSource(expectedName));
  }
  function acceptedHarnessSymbol() {
    if (process.env.NODE_ENV !== 'test' || !process.env.JEST_WORKER_ID) return null;
    const descriptor = descriptorOf(hostObjectPrototype, jestHarnessSymbol);
    if (!descriptor || descriptor.enumerable || !descriptor.configurable ||
        !descriptor.writable || !hasOwn(descriptor, 'value') ||
        !arrayIsArray(descriptor.value)) {
      return null;
    }
    const keys = ownKeys(descriptor.value);
    const length = descriptorOf(descriptor.value, 'length');
    return keys.length === 1 && keys[0] === 'length' && length &&
      length.value === 0 ? jestHarnessSymbol : null;
  }
  function objectPrototypeMatches(allowedHarnessSymbol) {
    if (getPrototypeOf(hostObjectPrototype) !== null) return false;
    const keys = ownKeys(hostObjectPrototype);
    let expectedIndex = 0;
    for (let index = 0; index < keys.length; index += 1) {
      if (keys[index] === allowedHarnessSymbol && allowedHarnessSymbol !== null) continue;
      const expectedKey = expectedIndex === 10 ? '__proto__' :
        objectFunctions[expectedIndex < 10 ? expectedIndex : expectedIndex - 1]?.[0];
      if (keys[index] !== expectedKey) return false;
      expectedIndex += 1;
    }
    if (expectedIndex !== 12) return false;
    for (let index = 0; index < 10; index += 1) {
      if (!nativeDataDescriptor({ owner: hostObjectPrototype,
        key: objectFunctions[index][0] }, objectFunctions[index][1])) return false;
    }
    if (!nativeDataDescriptor({ owner: hostObjectPrototype,
      key: 'toLocaleString' }, 'toLocaleString')) return false;
    const proto = descriptorOf(hostObjectPrototype, '__proto__');
    return Boolean(proto && proto.enumerable === false && proto.configurable === true &&
      !hasOwn(proto, 'value') && typeof proto.get === 'function' &&
      typeof proto.set === 'function' &&
      sourceOf(proto.get) === 'function get __proto__() { [native code] }' &&
      sourceOf(proto.set) === 'function set __proto__() { [native code] }');
  }
  function unscopablesMatch(value) {
    if (value === null || typeof value !== 'object' || getPrototypeOf(value) !== null) return false;
    const keys = ownKeys(value);
    if (keys.length !== unscopableNames.length) return false;
    for (let index = 0; index < keys.length; index += 1) {
      if (keys[index] !== unscopableNames[index]) return false;
      const descriptor = descriptorOf(value, keys[index]);
      if (!descriptor || descriptor.value !== true || descriptor.enumerable !== true ||
          descriptor.configurable !== true || descriptor.writable !== true) return false;
    }
    return true;
  }
  function arrayPrototypeMatches() {
    if (!arrayIsArray(hostArrayPrototype) ||
        getPrototypeOf(hostArrayPrototype) !== hostObjectPrototype) return false;
    const expectedKeys = ['length'];
    for (let index = 0; index < arrayFunctionNames.length; index += 1) {
      expectedKeys.push(arrayFunctionNames[index]);
    }
    expectedKeys.push(Symbol.iterator, Symbol.unscopables);
    const keys = ownKeys(hostArrayPrototype);
    if (keys.length !== expectedKeys.length) return false;
    for (let index = 0; index < keys.length; index += 1) {
      if (keys[index] !== expectedKeys[index]) return false;
    }
    const length = descriptorOf(hostArrayPrototype, 'length');
    if (!length || length.value !== 0 || length.enumerable || length.configurable ||
        length.writable !== true) return false;
    for (let index = 0; index < arrayFunctionNames.length; index += 1) {
      const key = arrayFunctionNames[index];
      const expectedName = key === 'constructor' ? 'Array' : key;
      if (!nativeDataDescriptor({ owner: hostArrayPrototype, key }, expectedName)) return false;
    }
    if (!nativeDataDescriptor({ owner: hostArrayPrototype,
      key: Symbol.iterator }, 'values')) return false;
    const unscopables = descriptorOf(hostArrayPrototype, Symbol.unscopables);
    return Boolean(unscopables && unscopables.enumerable === false &&
      unscopables.configurable === true && unscopables.writable === false &&
      unscopablesMatch(unscopables.value));
  }
  function assertCanonicalAmbientPrototypes() {
    const harness = acceptedHarnessSymbol();
    if (!objectPrototypeMatches(harness) || !arrayPrototypeMatches()) bootstrapInvalid();
  }

  // This is the first executable boundary. It runs before node:util, any Part
  // 13 dependency, serializer, digest, default builder or source read.
  assertCanonicalAmbientPrototypes();

  const utilModule = require('node:util');
  const typesDescriptor = descriptorOf(utilModule, 'types');
  const proxyDescriptor = descriptorOf(globalThis, 'Proxy');
  const isProxyDescriptor = typesDescriptor && descriptorOf(typesDescriptor.value, 'isProxy');
  if (!typesDescriptor || typeof typesDescriptor.value !== 'object' ||
      !isProxyDescriptor || typeof isProxyDescriptor.value !== 'function' ||
      !proxyDescriptor || typeof proxyDescriptor.value !== 'function') bootstrapInvalid();
  const isProxy = isProxyDescriptor.value;
  const ordinary = {};
  const proxy = new proxyDescriptor.value(ordinary, {});
  if (isProxy(ordinary) !== false || isProxy(proxy) !== true) bootstrapInvalid();

  function freeze(value) {
    const keys = ownKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const descriptor = descriptorOf(value, keys[index]);
      descriptor.configurable = false;
      if (hasOwn(descriptor, 'writable')) descriptor.writable = false;
      if (!defineProperty(value, keys[index], descriptor)) bootstrapInvalid();
    }
    if (!preventExtensions(value)) bootstrapInvalid();
    return value;
  }
  function create(prototype) {
    if (prototype !== null) bootstrapInvalid();
    return { __proto__: null };
  }
  function defineProperties(target, descriptors) {
    const keys = ownKeys(descriptors);
    for (let index = 0; index < keys.length; index += 1) {
      const holder = descriptorOf(descriptors, keys[index]);
      if (!holder || !hasOwn(holder, 'value') ||
          !defineProperty(target, keys[index], holder.value)) bootstrapInvalid();
    }
    return target;
  }
  function assertStrictPlainData(value, invalidFactory = bootstrapInvalid,
      maximumDepth = 32, maximumNodes = 8192) {
    assertCanonicalAmbientPrototypes();
    const visited = new Set();
    let nodes = 0;
    function reject() { throw invalidFactory(); }
    function visit(current, depth) {
      nodes += 1;
      if (nodes > maximumNodes || depth > maximumDepth) reject();
      if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
      if (typeof current === 'number') {
        if (!numberIsFinite(current) || objectIs(current, -0)) reject();
        return;
      }
      if (typeof current !== 'object' || isProxy(current) || visited.has(current)) reject();
      visited.add(current);
      const isArray = arrayIsArray(current);
      if (getPrototypeOf(current) !== (isArray ? hostArrayPrototype : hostObjectPrototype) ||
          descriptorOf(current, 'toJSON')) reject();
      const keys = ownKeys(current);
      for (let index = 0; index < keys.length; index += 1) {
        if (typeof keys[index] !== 'string') reject();
      }
      if (isArray) {
        const length = descriptorOf(current, 'length');
        if (!length || typeof length.value !== 'number' || length.enumerable ||
            keys.length !== length.value + 1) reject();
        for (let index = 0; index < length.value; index += 1) {
          const descriptor = descriptorOf(current, String(index));
          if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) reject();
          visit(descriptor.value, depth + 1);
        }
        return;
      }
      for (let index = 0; index < keys.length; index += 1) {
        const descriptor = descriptorOf(current, keys[index]);
        if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) reject();
        visit(descriptor.value, depth + 1);
      }
    }
    visit(value, 0);
  }
  function sameStrictPlainData(left, right) {
    try { assertStrictPlainData(left); assertStrictPlainData(right); }
    catch (_error) { return false; }
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
        const leftDescriptor = descriptorOf(leftValue, leftKeys[index]);
        const rightDescriptor = descriptorOf(rightValue, rightKeys[index]);
        if (!leftDescriptor || !rightDescriptor || !hasOwn(leftDescriptor, 'value') ||
            !hasOwn(rightDescriptor, 'value') ||
            !same(leftDescriptor.value, rightDescriptor.value)) return false;
      }
      return true;
    }
    return same(left, right);
  }
  function exactSourceRecord(value) {
    assertStrictPlainData(value);
    if (arrayIsArray(value)) bootstrapInvalid();
    const sourceKeys = ['organizationId', 'actorUserId', 'actorAccessRole', 'authSessionId'];
    const keys = ownKeys(value);
    if (keys.length !== sourceKeys.length) bootstrapInvalid();
    const record = create(null);
    for (let index = 0; index < sourceKeys.length; index += 1) {
      let recognized = false;
      for (let allowed = 0; allowed < sourceKeys.length; allowed += 1) {
        if (keys[index] === sourceKeys[allowed]) { recognized = true; break; }
      }
      const descriptor = descriptorOf(value, sourceKeys[index]);
      if (!recognized || !descriptor || !descriptor.enumerable ||
          !hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') bootstrapInvalid();
      record[sourceKeys[index]] = descriptor.value;
    }
    return record;
  }
  function createBoundary() {
    const api = create(null);
    const values = {
      __proto__: null,
      assertCanonicalAmbientPrototypes, assertStrictPlainData, sameStrictPlainData,
      exactSourceRecord, freeze, ownKeys, getOwnPropertyDescriptor: descriptorOf,
      getPrototypeOf, create, defineProperties, preventExtensions, defineProperty,
      arrayIsArray, numberIsFinite, objectIs, hasOwn, jestHarnessSymbol,
      matchesCanonicalPrototype(value, isArray, allowedHarnessSymbol) {
        return isArray ? value === hostArrayPrototype && arrayPrototypeMatches() :
          value === hostObjectPrototype && objectPrototypeMatches(allowedHarnessSymbol);
      },
    };
    const keys = ownKeys(values);
    for (let index = 0; index < keys.length; index += 1) api[keys[index]] = values[keys[index]];
    return api;
  }
  return { createBoundary, isProxy };
}

const realmRuntime = captureBoundaryRuntime();

// This validator is private to this module, fixed-manifest based, and created
// before any Part 13 dependency is imported. Ambient Object static methods and
// replaceable CommonJS helpers are not part of its bootstrap.
const privatePlainData = realmRuntime.createBoundary();
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
