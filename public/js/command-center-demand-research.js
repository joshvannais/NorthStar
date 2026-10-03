(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NorthStarDemandResearch = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;
  var DIGEST = /^[0-9a-f]{64}$/;
  var PRIVATE = new Set(['probability', 'outputDigest', 'privateOutput', 'privatePoint',
    'expectedCount', 'actualLeadCount', 'actualFirstBookedCount', 'absoluteError',
    'members', 'periods', 'evidence', 'privateMetrics']);
  var FALSE_FLAGS = ['forecastIssued', 'paidNumericServing', 'forecastServingEnabled'];
  var TRANSITION_TARGETS = [
    'demand.qualification_transition.v1',
    'demand.estimate_request_transition.v1',
    'demand.booking_transition.v1',
    'demand.booking_cancellation.v1',
  ];
  var TRANSITION_METHOD_VERSION = 'm26-transition-four-target-research-v2';
  var TRANSITION_CALCULATION_VERSION = 'm26-two-complete-local-month-weighted-rate-v2';
  var TRANSITION_REVIEW_VERSION = 'm26-source-finalization-human-review-v2';
  var SEASONAL_CALCULATION_VERSION = 'm26-seasonal-two-cycle-open-minute-v1';
  var PIPELINE_CALCULATION_VERSION = 'm26-pipeline-first-booking-pooled-v1';
  var SEASONAL_SIGNALS = ['repeated_high', 'repeated_low', 'repeated_neutral',
    'authenticated_complete_zero_no_signal'];

  function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function exact(value, required, optional) {
    if (!record(value)) return false;
    optional = optional || [];
    var allowed = required.concat(optional), keys = Object.keys(value);
    return required.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); }) &&
      keys.every(function (key) { return allowed.includes(key); });
  }
  function privatePoison(value, seen) {
    if (!value || typeof value !== 'object') return false;
    seen = seen || new Set();
    if (seen.has(value)) return true;
    seen.add(value);
    if (Array.isArray(value)) return value.some(function (item) { return privatePoison(item, seen); });
    if (!record(value) || Object.keys(value).some(function (key) { return PRIVATE.has(key); })) return true;
    return Object.keys(value).some(function (key) { return privatePoison(value[key], seen); });
  }
  function clean(value) {
    return record(value) && !privatePoison(value);
  }
  function falseFlags(value) {
    return FALSE_FLAGS.every(function (key) { return value[key] === false; });
  }
  function instant(value) {
    return typeof value === 'string' &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:\d{3})?Z$/.test(value) &&
      Number.isFinite(Date.parse(value));
  }
  function localDate(value) {
    return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) &&
      new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value;
  }
  function timeZone(value) {
    if (typeof value !== 'string' || !value || value.length > 80) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0)); return true; }
    catch (_error) { return false; }
  }
  function uuid(value) { return typeof value === 'string' && UUID.test(value); }
  function orderedTargets(value) {
    return Array.isArray(value) && value.length === TRANSITION_TARGETS.length &&
      value.every(function (target, index) { return target === TRANSITION_TARGETS[index]; });
  }
  function envelope(value) {
    return exact(value, ['success', 'data']) && value.success === true && clean(value.data) ? value.data : null;
  }
  function noPrivateOutput(value) {
    return clean(value) && value.researchOnly === true && falseFlags(value);
  }
  function idState(value, states, expectedId) {
    return clean(value) && states.includes(value.state) && uuid(value.id) &&
      (!expectedId || value.id === expectedId);
  }

  function validateRetell(value, expectedId) {
    if (!clean(value)) return null;
    if (value.state === 'retell_future_unavailable') {
      return exact(value, ['state', 'reason', 'researchOnly', 'realForecastEligible',
        'paidNumericServing', 'forecastServingEnabled', 'forecastIssued']) &&
        typeof value.reason === 'string' && value.reason && noPrivateOutput(value) &&
        value.realForecastEligible === false ? value : null;
    }
    if (value.state === 'retell_future_origin_stale') {
      return exact(value, ['state', 'id', 'refreshRequired', 'researchOnly', 'amountWithheld',
        'realForecastEligible', 'paidNumericServing', 'forecastServingEnabled', 'forecastIssued']) &&
        idState(value, [value.state], expectedId) && value.refreshRequired === true &&
        value.amountWithheld === true && value.realForecastEligible === false && noPrivateOutput(value) ? value : null;
    }
    var saved = value.state === 'retell_future_origin_saved';
    var current = value.state === 'retell_future_origin_current';
    if (!saved && !current) return null;
    var required = ['state', 'id', 'asOf', 'localHorizonStart', 'researchOnly', 'amountWithheld',
      'scope', 'serviceMixAvailable', 'areaForecastAvailable', 'providerIndependentVerified',
      'wholeBusinessCoverageVerified', 'realForecastEligible', 'paidNumericServing',
      'forecastServingEnabled', 'forecastIssued'];
    if (saved) required.push('evidenceDigest', 'replayed');
    else required.push('horizonStartsAt', 'horizonEndsAt', 'targetKey', 'targetVersion', 'evidenceDigest');
    return exact(value, required) && idState(value, [value.state], expectedId) &&
      instant(value.asOf) && MONTH.test(value.localHorizonStart) && DIGEST.test(value.evidenceDigest || '') &&
      (!saved || typeof value.replayed === 'boolean') &&
      (!current || (instant(value.horizonStartsAt) && instant(value.horizonEndsAt) &&
        Date.parse(value.horizonStartsAt) < Date.parse(value.horizonEndsAt) &&
        value.targetKey === 'demand.inbound_leads' && value.targetVersion === 'v1')) &&
      value.scope === 'retell_only_tenant_all' && value.amountWithheld === true &&
      value.serviceMixAvailable === false && value.areaForecastAvailable === false &&
      value.providerIndependentVerified === false && value.wholeBusinessCoverageVerified === false &&
      value.realForecastEligible === false && noPrivateOutput(value) ? value : null;
  }

  function validateTransitionReview(value) {
    if (!clean(value) || value.researchOnly !== true || value.automaticSelection !== false ||
        value.automaticActionTaken !== false || value.forecastIssued !== false ||
        value.paidNumericServing !== false || value.forecastServingEnabled !== false) return null;
    if (value.state === 'transition_method_review_unavailable') {
      return exact(value, ['state', 'reason', 'expectedRevision', 'expectedDigest', 'approved',
        'researchOnly', 'automaticSelection', 'automaticActionTaken', 'forecastIssued',
        'paidNumericServing', 'forecastServingEnabled']) && value.reason === 'review_missing' &&
        value.expectedRevision === 0 && value.expectedDigest === 'none' && value.approved === false ? value : null;
    }
    if (value.state !== 'transition_method_review_current') return null;
    return exact(value, ['state', 'id', 'revision', 'action', 'approved', 'reviewDigest', 'methodId',
      'methodDigest', 'methodVersion', 'calculationVersion', 'reviewVersion', 'targets', 'reviewedAt',
      'researchOnly', 'automaticSelection', 'automaticActionTaken', 'forecastIssued',
      'paidNumericServing', 'forecastServingEnabled']) && uuid(value.id) && uuid(value.methodId) &&
      Number.isSafeInteger(value.revision) && value.revision > 0 && ['approve', 'reject'].includes(value.action) &&
      value.approved === (value.action === 'approve') && DIGEST.test(value.reviewDigest || '') &&
      DIGEST.test(value.methodDigest || '') && value.methodVersion === TRANSITION_METHOD_VERSION &&
      value.calculationVersion === TRANSITION_CALCULATION_VERSION &&
      value.reviewVersion === TRANSITION_REVIEW_VERSION && orderedTargets(value.targets) &&
      instant(value.reviewedAt) ? value : null;
  }

  function validateTransitionReviewMutation(value, action) {
    return clean(value) && exact(value, ['state', 'id', 'revision', 'action', 'reviewDigest',
      'methodId', 'methodDigest', 'replayed', 'approved', 'researchOnly',
      'automaticSelection', 'automaticActionTaken', 'forecastIssued', 'paidNumericServing',
      'forecastServingEnabled']) && value.state === 'transition_method_review_recorded' &&
      uuid(value.id) && Number.isSafeInteger(value.revision) && value.revision > 0 &&
      value.action === action && DIGEST.test(value.reviewDigest || '') &&
      uuid(value.methodId) && DIGEST.test(value.methodDigest || '') &&
      typeof value.replayed === 'boolean' &&
      value.approved === (action === 'approve') && value.researchOnly === true &&
      value.automaticSelection === false && value.automaticActionTaken === false &&
      value.forecastIssued === false && value.paidNumericServing === false &&
      value.forecastServingEnabled === false ? value : null;
  }

  function validateTransitionOrigin(value, expectedId) {
    if (!clean(value) || value.researchOnly !== true || value.paidNumericServing !== false ||
        value.forecastServingEnabled !== false) return null;
    if (['transition_origin_unavailable', 'transition_origin_stale'].includes(value.state)) {
      var required = ['state', 'reason', 'refreshRequired', 'researchOnly', 'probabilityWithheld',
        'outputDigestWithheld', 'sourceCoverageComplete', 'realForecastEligible', 'forecastIssued',
        'paidNumericServing', 'forecastServingEnabled'];
      if (value.state === 'transition_origin_unavailable') required.splice(2, 1);
      else required.splice(2, 0, 'id');
      var optionalFalse = ['providerCoverageVerified', 'offPlatformCoverageVerified',
        'wholeBusinessCoverageVerified', 'empiricalCalibrationVerified', 'empiricalDriftVerified'];
      return exact(value, required, ['providerCoverageVerified', 'offPlatformCoverageVerified',
        'wholeBusinessCoverageVerified', 'empiricalCalibrationVerified', 'empiricalDriftVerified']) &&
        (value.state === 'transition_origin_unavailable' || uuid(value.id)) &&
        (!expectedId || value.id === expectedId) && typeof value.reason === 'string' && value.reason &&
        (value.refreshRequired === undefined || value.refreshRequired === true) &&
        value.probabilityWithheld === true && value.outputDigestWithheld === true &&
        value.sourceCoverageComplete === false && value.realForecastEligible === false &&
        value.forecastIssued === false && optionalFalse.every(function (key) {
          return value[key] === undefined || value[key] === false;
        }) ? value : null;
    }
    if (!idState(value, ['transition_origin_saved', 'transition_origin_current'], expectedId)) return null;
    var requiredCurrent = ['state', 'id', 'asOf', 'predictionCutoffAt', 'horizonEndsAt', 'targets',
      'sourceCoverageComplete', 'sourceCoverageScope', 'uncertaintyState', 'researchOnly',
      'probabilityWithheld', 'outputDigestWithheld', 'providerCoverageVerified',
      'offPlatformCoverageVerified', 'wholeBusinessCoverageVerified', 'naturalProductionHistoryVerified',
      'empiricalCalibrationVerified', 'empiricalDriftVerified', 'realForecastEligible', 'forecastIssued',
      'paidNumericServing', 'forecastServingEnabled'];
    var requiredSaved = requiredCurrent.concat(['replayed']);
    if (value.state === 'transition_origin_current') requiredCurrent.splice(5, 0, 'timeZone', 'methodVersion', 'calculationVersion', 'reviewVersion');
    var keys = value.state === 'transition_origin_saved' ? requiredSaved : requiredCurrent;
    return exact(value, keys) && instant(value.asOf) && instant(value.predictionCutoffAt) &&
      instant(value.horizonEndsAt) && Date.parse(value.predictionCutoffAt) < Date.parse(value.horizonEndsAt) &&
      orderedTargets(value.targets) &&
      value.sourceCoverageComplete === true && value.sourceCoverageScope ===
        'post_installation_northstar_selected_sources_only' &&
      value.uncertaintyState === 'unavailable_insufficient_natural_calibration' &&
      value.probabilityWithheld === true && value.outputDigestWithheld === true &&
      value.providerCoverageVerified === false && value.offPlatformCoverageVerified === false &&
      value.wholeBusinessCoverageVerified === false && value.naturalProductionHistoryVerified === false &&
      value.empiricalCalibrationVerified === false &&
      value.empiricalDriftVerified === false && value.realForecastEligible === false &&
      (value.state !== 'transition_origin_saved' || typeof value.replayed === 'boolean') &&
      (value.state !== 'transition_origin_current' ||
        (value.methodVersion === TRANSITION_METHOD_VERSION &&
         value.calculationVersion === TRANSITION_CALCULATION_VERSION &&
         value.reviewVersion === TRANSITION_REVIEW_VERSION &&
         timeZone(value.timeZone))) &&
      noPrivateOutput(value) ? value : null;
  }

  function validateTransitionEvaluation(value, expectedOrigin, expectedId) {
    if (!clean(value) || value.researchOnly !== true || value.metricsWithheld !== true ||
        value.paidNumericServing !== false || value.forecastServingEnabled !== false) return null;
    if (value.state === 'transition_evaluation_unavailable') {
      return exact(value, ['state', 'reason', 'researchOnly', 'metricsWithheld', 'calibrationClaimed',
        'driftVerdictIssued', 'automaticActionTaken', 'paidNumericServing', 'forecastServingEnabled']) &&
        typeof value.reason === 'string' && value.reason && value.calibrationClaimed === false &&
        value.driftVerdictIssued === false && value.automaticActionTaken === false ? value : null;
    }
    if (!idState(value, ['transition_evaluation_saved', 'transition_evaluation_current',
      'transition_evaluation_stale'], expectedId)) return null;
    if (expectedOrigin && value.originId !== expectedOrigin) return null;
    if (value.state === 'transition_evaluation_stale') {
      return exact(value, ['state', 'id', 'originId', 'reason', 'refreshRequired', 'researchOnly',
        'metricsWithheld', 'calibrationClaimed', 'driftVerdictIssued', 'automaticActionTaken',
        'paidNumericServing', 'forecastServingEnabled']) && uuid(value.originId) && value.refreshRequired === true &&
        value.calibrationClaimed === false && value.driftVerdictIssued === false &&
        value.automaticActionTaken === false ? value : null;
    }
    var required = ['state', 'id', 'originId', 'revision', 'researchOnly', 'metricsWithheld',
      'calibrationClaimed', 'driftVerdictIssued', 'automaticActionTaken', 'paidNumericServing',
      'forecastServingEnabled'];
    if (value.state === 'transition_evaluation_saved') required.push('replayed');
    else required.push('evaluatedAt');
    return exact(value, required) && uuid(value.originId) && Number.isSafeInteger(value.revision) &&
      value.revision > 0 &&
      (value.state === 'transition_evaluation_saved' ?
        (typeof value.replayed === 'boolean' && value.evaluatedAt === undefined) :
        (value.replayed === undefined && instant(value.evaluatedAt))) &&
      value.calibrationClaimed === false && value.driftVerdictIssued === false &&
      value.automaticActionTaken === false ? value : null;
  }

  function validateDemandOrigin(value, kind, expectedId) {
    if (!clean(value) || value.researchOnly !== true || value.forecastIssued !== false ||
        value.paidNumericServing !== false || value.forecastServingEnabled !== false) return null;
    var prefix = kind + '_origin', withheld = kind === 'seasonal' ? 'amountWithheld' : 'countWithheld';
    if (value.state === prefix + '_unavailable') {
      return exact(value, ['state', 'reason', 'researchOnly', withheld, 'forecastIssued',
        'paidNumericServing', 'forecastServingEnabled']) && typeof value.reason === 'string' && value.reason &&
        value[withheld] === true ? value : null;
    }
    if (value.state === prefix + '_stale') {
      return exact(value, ['state', 'id', 'refreshRequired', 'researchOnly', withheld,
        'outputDigestWithheld', 'forecastIssued', 'paidNumericServing', 'forecastServingEnabled']) &&
        idState(value, [value.state], expectedId) && value.refreshRequired === true &&
        value[withheld] === true && value.outputDigestWithheld === true ? value : null;
    }
    if (!idState(value, [prefix + '_saved', prefix + '_current'], expectedId) ||
        value[withheld] !== true || value.outputDigestWithheld !== true) return null;
    if (kind === 'seasonal') {
      var required = ['state', 'id', 'localHorizonStart', 'researchOnly', withheld,
        'outputDigestWithheld', 'seasonalSignalState', 'forecastIssued', 'paidNumericServing',
        'forecastServingEnabled'];
      var optional = ['horizonStartsAt', 'horizonEndsAt', 'replayed'];
      return exact(value, required, optional) && MONTH.test(value.localHorizonStart) &&
        SEASONAL_SIGNALS.includes(value.seasonalSignalState) &&
        (value.state === prefix + '_saved' ?
          (typeof value.replayed === 'boolean' && value.horizonStartsAt === undefined &&
           value.horizonEndsAt === undefined) :
          (value.replayed === undefined && instant(value.horizonStartsAt) &&
           instant(value.horizonEndsAt) &&
           Date.parse(value.horizonStartsAt) < Date.parse(value.horizonEndsAt))) ? value : null;
    }
    return exact(value, ['state', 'id', 'predictionCutoffAt', 'horizonEndsAt', 'researchOnly',
      withheld, 'outputDigestWithheld', 'forecastIssued', 'paidNumericServing', 'forecastServingEnabled'],
    ['replayed']) && instant(value.predictionCutoffAt) && instant(value.horizonEndsAt) &&
      Date.parse(value.horizonEndsAt) - Date.parse(value.predictionCutoffAt) === 30 * 24 * 60 * 60 * 1000 &&
      (value.state === prefix + '_saved' ? typeof value.replayed === 'boolean' :
        value.replayed === undefined) ? value : null;
  }

  function validateDemandEvaluation(value, kind, expectedOrigin, expectedId) {
    if (!clean(value) || value.researchOnly !== true || value.metricsWithheld !== true ||
        value.forecastIssued !== false || value.paidNumericServing !== false ||
        value.forecastServingEnabled !== false) return null;
    var prefix = kind + '_evaluation';
    if (value.state === prefix + '_unavailable') {
      return exact(value, ['state', 'reason', 'researchOnly', 'metricsWithheld', 'forecastIssued',
        'paidNumericServing', 'forecastServingEnabled']) && typeof value.reason === 'string' && value.reason ? value : null;
    }
    if (!idState(value, [prefix + '_saved', prefix + '_current', prefix + '_stale'], expectedId)) return null;
    if (!uuid(value.originId) || (expectedOrigin && value.originId !== expectedOrigin)) return null;
    if (value.state === prefix + '_stale') {
      return exact(value, ['state', 'id', 'originId', 'refreshRequired', 'researchOnly',
        'metricsWithheld', 'forecastIssued', 'paidNumericServing', 'forecastServingEnabled']) &&
        value.refreshRequired === true ? value : null;
    }
    var evaluationRequired = ['state', 'id', 'originId', 'revision', 'researchOnly', 'metricsWithheld',
      'forecastIssued', 'paidNumericServing', 'forecastServingEnabled'];
    if (value.state === prefix + '_saved') evaluationRequired.push('replayed');
    else evaluationRequired.push('evaluatedAt');
    return exact(value, evaluationRequired) &&
      Number.isSafeInteger(value.revision) && value.revision > 0 &&
      (value.state === prefix + '_saved' ? typeof value.replayed === 'boolean' :
        value.replayed === undefined) &&
      (value.state === prefix + '_current' ? instant(value.evaluatedAt) :
        value.evaluatedAt === undefined) ? value : null;
  }

  function validatePrerequisites(value) {
    if (!clean(value) || !exact(value, ['state', 'profile', 'seasonal', 'pipeline',
      'researchOnly', 'automaticActionTaken', 'forecastIssued', 'paidNumericServing',
      'forecastServingEnabled']) || value.state !== 'demand_ui_prerequisites_current' ||
        value.researchOnly !== true || value.automaticActionTaken !== false || !falseFlags(value) ||
        !exact(value.profile, ['state', 'anchorId']) ||
        !['current', 'unavailable'].includes(value.profile.state) ||
        (value.profile.state === 'current' ? !uuid(value.profile.anchorId) : value.profile.anchorId !== null)) return null;
    function item(candidate, purpose, target) {
      if (!exact(candidate, ['purpose', 'targetKey', 'targetVersion', 'calculationVersion',
        'method', 'epoch']) || candidate.purpose !== purpose || candidate.targetKey !== target ||
          candidate.targetVersion !== 'v1' ||
          candidate.calculationVersion !== (purpose === 'seasonal_inbound' ?
            SEASONAL_CALCULATION_VERSION : PIPELINE_CALCULATION_VERSION) ||
          !exact(candidate.method, ['expectedRevision', 'expectedDigest', 'action', 'approved']) ||
          !Number.isSafeInteger(candidate.method.expectedRevision) || candidate.method.expectedRevision < 0 ||
          !(candidate.method.expectedDigest === 'none' || DIGEST.test(candidate.method.expectedDigest || '')) ||
          ((candidate.method.expectedRevision === 0) !== (candidate.method.expectedDigest === 'none')) ||
          ![null, 'approve', 'reject'].includes(candidate.method.action) ||
          candidate.method.approved !== (candidate.method.action === 'approve') ||
          !exact(candidate.epoch, ['state', 'id', 'revision', 'installedAt']) ||
          !['missing', 'current', 'stale'].includes(candidate.epoch.state)) return false;
      return candidate.epoch.state === 'missing' ? candidate.epoch.id === null &&
        candidate.epoch.revision === null && candidate.epoch.installedAt === null :
        uuid(candidate.epoch.id) && Number.isSafeInteger(candidate.epoch.revision) &&
        candidate.epoch.revision > 0 && instant(candidate.epoch.installedAt);
    }
    return item(value.seasonal, 'seasonal_inbound', 'demand.inbound_leads') &&
      item(value.pipeline, 'pipeline_first_booking', 'demand.pipeline_first_accepted_bookings') ? value : null;
  }

  function validConsentItem(item) {
    return exact(item, ['id', 'revision', 'action', 'digest', 'createdAt', 'reason',
      'sourceScope', 'boundary']) && uuid(item.id) && Number.isSafeInteger(item.revision) &&
      item.revision > 0 && ['grant', 'revoke'].includes(item.action) && DIGEST.test(item.digest || '') &&
      instant(item.createdAt) && Array.isArray(item.sourceScope) && item.sourceScope.length === 1 &&
      item.sourceScope[0] === 'retell.inbound_calls' && typeof item.reason === 'string' &&
      item.reason.trim().length >= 10 && item.reason.length <= 1000 &&
      item.boundary === 'Company permission does not establish caller consent, provider coverage or retention.';
  }
  function validateConsent(value) {
    if (!clean(value) || !exact(value, ['state', 'active', 'current', 'history', 'total', 'truncated',
      'callerConsentVerified', 'providerCoverageVerified', 'retentionVerified', 'forecastIssued']) ||
      !['company_permission_active', 'company_permission_inactive'].includes(value.state) ||
      typeof value.active !== 'boolean' || value.active !== (value.state === 'company_permission_active') ||
      !Array.isArray(value.history) || value.history.length > 20 ||
      value.history.some(function (item) { return !validConsentItem(item); }) ||
      !(value.current === null || validConsentItem(value.current)) ||
      !Number.isSafeInteger(value.total) || value.total < value.history.length ||
      typeof value.truncated !== 'boolean' || value.truncated !== (value.total > 20) ||
      (value.current === null ? (value.active || value.total !== 0 || value.history.length !== 0) :
        (value.history.length === 0 || value.current.id !== value.history[0].id ||
         value.current.revision !== value.history[0].revision ||
         value.current.digest !== value.history[0].digest ||
         value.current.revision !== value.total || value.active !== (value.current.action === 'grant'))) ||
      value.history.some(function (item, index) {
        return index > 0 && item.revision !== value.history[index - 1].revision - 1;
      }) || value.callerConsentVerified !== false ||
      value.providerCoverageVerified !== false || value.retentionVerified !== false ||
      value.forecastIssued !== false) return null;
    return value;
  }
  function validateConsentMutation(value) {
    return clean(value) && exact(value, ['state', 'consentId', 'revision', 'digest', 'action',
      'current', 'replayed', 'callerConsentVerified', 'providerCoverageVerified',
      'retentionVerified', 'forecastIssued']) &&
      ['company_permission_active', 'company_permission_inactive'].includes(value.state) &&
      uuid(value.consentId) && Number.isSafeInteger(value.revision) && value.revision > 0 &&
      DIGEST.test(value.digest || '') && ['grant', 'revoke'].includes(value.action) &&
      typeof value.current === 'boolean' && value.current === (value.action === 'grant') &&
      value.state === (value.current ? 'company_permission_active' : 'company_permission_inactive') &&
      typeof value.replayed === 'boolean' &&
      value.callerConsentVerified === false && value.providerCoverageVerified === false &&
      value.retentionVerified === false && value.forecastIssued === false ? value : null;
  }
  function validateEpoch(value, purpose) {
    if (!clean(value)) return null;
    if (value.state === 'demand_schedule_epoch_unavailable') return exact(value,
      ['state', 'reason']) && typeof value.reason === 'string' && value.reason ? value : null;
    return exact(value, ['state', 'id', 'purpose', 'installedAt', 'digest', 'replayed'], ['revision']) &&
      value.state === 'demand_schedule_epoch_recorded' && uuid(value.id) && value.purpose === purpose &&
      instant(value.installedAt) && DIGEST.test(value.digest || '') && typeof value.replayed === 'boolean' &&
      (value.revision === undefined || (Number.isSafeInteger(value.revision) && value.revision > 0)) ? value : null;
  }
  function validateMethodMutation(value, purpose, action) {
    return clean(value) && exact(value, ['state', 'id', 'purpose', 'revision', 'action', 'digest',
      'replayed', 'researchOnly', 'automaticActionTaken']) &&
      value.state === 'demand_schedule_method_review_recorded' && uuid(value.id) &&
      value.purpose === purpose && Number.isSafeInteger(value.revision) && value.revision > 0 &&
      value.action === action && DIGEST.test(value.digest || '') && typeof value.replayed === 'boolean' &&
      value.researchOnly === true && value.automaticActionTaken === false ? value : null;
  }
  function validatePeriodSnapshot(value, month) {
    if (!clean(value)) return null;
    if (value.state === 'retell_period_snapshot_unavailable') return exact(value,
      ['state', 'reason', 'localMonthStart', 'refreshRequired', 'providerCoverageVerified',
        'wholeBusinessCoverageVerified', 'forecastIssued']) && value.localMonthStart === month &&
        typeof value.reason === 'string' && value.reason && typeof value.refreshRequired === 'boolean' &&
        value.providerCoverageVerified === false && value.wholeBusinessCoverageVerified === false &&
        value.forecastIssued === false ? value : null;
    var sourceIds = new Set();
    return exact(value, ['state', 'snapshotId', 'localMonthStart', 'sourceWindowStartsAt',
      'sourceWindowEndsAt', 'sourceSnapshotDigest', 'sources', 'sourceCount', 'replayed',
      'reviewedLeadIdentityVerified', 'providerCoverageVerified', 'wholeBusinessCoverageVerified',
      'forecastIssued']) && value.state === 'retell_period_snapshot_saved' && uuid(value.snapshotId) &&
      value.localMonthStart === month && instant(value.sourceWindowStartsAt) &&
      instant(value.sourceWindowEndsAt) && DIGEST.test(value.sourceSnapshotDigest || '') &&
      Date.parse(value.sourceWindowStartsAt) < Date.parse(value.sourceWindowEndsAt) &&
      Array.isArray(value.sources) && Number.isSafeInteger(value.sourceCount) && value.sourceCount >= 0 &&
      value.sources.length === value.sourceCount && value.sourceCount <= 1000 &&
      !value.sources.some(function (source) {
        return !exact(source, ['callSourceId', 'sourceDigest', 'occurredAt', 'recordedAt']) ||
          !uuid(source.callSourceId) || sourceIds.has(source.callSourceId) ||
          !DIGEST.test(source.sourceDigest || '') ||
          !(source.occurredAt === null || (instant(source.occurredAt) &&
            Date.parse(source.occurredAt) >= Date.parse(value.sourceWindowStartsAt) &&
            Date.parse(source.occurredAt) < Date.parse(value.sourceWindowEndsAt))) ||
          !instant(source.recordedAt) || (sourceIds.add(source.callSourceId), false);
      }) && typeof value.replayed === 'boolean' && value.reviewedLeadIdentityVerified === false &&
      value.providerCoverageVerified === false && value.wholeBusinessCoverageVerified === false &&
      value.forecastIssued === false ? value : null;
  }
  function periodReviewSnapshot(value) {
    if (!value || value.state !== 'retell_period_snapshot_saved') return null;
    return {
      state: 'retell_call_source_current', snapshotId: value.snapshotId,
      sourceSnapshotDigest: value.sourceSnapshotDigest, sources: value.sources,
      refreshRequired: false, reviewedLeadIdentityVerified: false,
      historicalCoverageVerified: false, providerCoverageVerified: false,
      retentionVerified: false, forecastIssued: false,
    };
  }
  function validateCertification(value, month) {
    if (!clean(value) || value.localMonthStart !== month ||
        !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 ||
        !(value.expectedDigest === 'none' || DIGEST.test(value.expectedDigest || ''))) return null;
    if (value.state === 'retell_period_certification_missing') return exact(value,
      ['state', 'localMonthStart', 'expectedRevision', 'expectedDigest',
        'providerCoverageVerified', 'wholeBusinessCoverageVerified', 'forecastIssued']) &&
        value.expectedRevision === 0 && value.expectedDigest === 'none' ? value : null;
    return exact(value, ['state', 'id', 'localMonthStart', 'snapshotId', 'revision', 'digest',
      'action', 'recordedAt', 'expectedRevision', 'expectedDigest', 'callerConsentAttested',
      'providerCoverageAttested', 'retentionAttested', 'providerIndependentVerified',
      'wholeBusinessCoverageVerified', 'forecastIssued', 'paidNumericServing']) &&
      ['retell_period_certified', 'retell_period_revoked'].includes(value.state) &&
      uuid(value.id) && uuid(value.snapshotId) && Number.isSafeInteger(value.revision) &&
      value.revision > 0 && DIGEST.test(value.digest || '') && instant(value.recordedAt) &&
      value.expectedRevision === value.revision && value.expectedDigest === value.digest &&
      value.action === (value.state === 'retell_period_certified' ? 'certify' : 'revoke') &&
      typeof value.callerConsentAttested === 'boolean' &&
      typeof value.providerCoverageAttested === 'boolean' &&
      typeof value.retentionAttested === 'boolean' &&
      value.callerConsentAttested === (value.action === 'certify') &&
      value.providerCoverageAttested === (value.action === 'certify') &&
      value.retentionAttested === (value.action === 'certify') &&
      value.providerIndependentVerified === false && value.wholeBusinessCoverageVerified === false &&
      value.forecastIssued === false && value.paidNumericServing === false ? value : null;
  }

  function validateProfileWindow(value, month) {
    var windowValue = value && value.window;
    var windowKeys = ['version', 'organizationId', 'businessProfileId',
      'businessProfileVersion', 'businessProfileHash', 'timeZone', 'grain',
      'serviceKey', 'areaScope', 'areaDigest', 'calendarState', 'calendarDigest',
      'localStartDate', 'localEndDate', 'startsAt', 'endsAt', 'elapsedMinutes',
      'openMinutes', 'openMinutesBasis'];
    return clean(value) && exact(value, ['window', 'profileBasis',
      'historicalCalendarVerified', 'observationCoverageVerified',
      'sourceEligibilityVerified', 'forecastIssued']) && exact(windowValue, windowKeys) &&
      value.profileBasis === 'current_active_profile_at_read' &&
      value.historicalCalendarVerified === false && value.observationCoverageVerified === false &&
      value.sourceEligibilityVerified === false && value.forecastIssued === false &&
      windowValue.version === 'm26-time-series-window-v1' && uuid(windowValue.organizationId) &&
      uuid(windowValue.businessProfileId) && DIGEST.test(windowValue.businessProfileHash || '') &&
      Number.isSafeInteger(windowValue.businessProfileVersion) && windowValue.businessProfileVersion > 0 &&
      timeZone(windowValue.timeZone) &&
      windowValue.grain === 'month' && windowValue.localStartDate === month &&
      localDate(windowValue.localEndDate) && windowValue.localEndDate > windowValue.localStartDate &&
      windowValue.serviceKey === null && windowValue.areaScope === 'tenant_all' &&
      windowValue.areaDigest === null &&
      windowValue.calendarState === 'known' && DIGEST.test(windowValue.calendarDigest || '') &&
      instant(windowValue.startsAt) && instant(windowValue.endsAt) &&
      Date.parse(windowValue.startsAt) < Date.parse(windowValue.endsAt) &&
      Number.isSafeInteger(windowValue.elapsedMinutes) && windowValue.elapsedMinutes > 0 &&
      Number.isSafeInteger(windowValue.openMinutes) && windowValue.openMinutes >= 0 &&
      windowValue.openMinutesBasis === 'opening_local_date' ? value : null;
  }

  function validateProfileAnchor(value, expectedId) {
    if (!clean(value) || !['profile_effective_anchor_recorded',
      'profile_effective_anchor_unavailable', 'profile_effective_activation_recorded',
      'profile_effective_activation_unavailable'].includes(value.state)) return null;
    if (value.state.endsWith('_unavailable')) {
      return exact(value, ['state', 'reason', 'historicalCalendarVerified', 'forecastIssued']) &&
        typeof value.reason === 'string' && value.reason &&
        value.historicalCalendarVerified === false && value.forecastIssued === false ? value : null;
    }
    var activation = value.state === 'profile_effective_activation_recorded';
    return exact(value, ['state', 'anchorId', activation ? 'observedAt' : 'capturedAt',
      'replayed', 'historicalCalendarVerified', 'forecastIssued']) && uuid(value.anchorId) &&
      (!expectedId || value.anchorId === expectedId) &&
      instant(value[activation ? 'observedAt' : 'capturedAt']) && typeof value.replayed === 'boolean' &&
      value.historicalCalendarVerified === false && value.forecastIssued === false ? value : null;
  }

  function validAttestation(value, month) {
    return exact(value, ['id', 'revision', 'digest', 'action', 'businessProfileId',
      'businessProfileVersion', 'businessProfileHash', 'profilePinVerified',
      'localStartDate', 'recordedAt', 'evidenceKind', 'historicalCalendarVerified',
      'observationCoverageVerified', 'forecastIssued']) && uuid(value.id) &&
      Number.isSafeInteger(value.revision) && value.revision > 0 && DIGEST.test(value.digest || '') &&
      ['confirm', 'revoke'].includes(value.action) && uuid(value.businessProfileId) &&
      Number.isSafeInteger(value.businessProfileVersion) && value.businessProfileVersion > 0 &&
      DIGEST.test(value.businessProfileHash || '') && typeof value.profilePinVerified === 'boolean' &&
      value.profilePinVerified === (value.action === 'confirm') &&
      value.localStartDate === month && instant(value.recordedAt) &&
      value.evidenceKind === 'owner_reviewed_historical_profile_applicability' &&
      value.historicalCalendarVerified === false && value.observationCoverageVerified === false &&
      value.forecastIssued === false;
  }

  function validateAttestationRead(value, month) {
    if (!clean(value) || !exact(value, ['attestation', 'ownerConfirmedHistoricalProfile',
      'profilePinVerified', 'historicalCalendarVerified', 'observationCoverageVerified',
      'forecastIssued']) || value.historicalCalendarVerified !== false ||
      value.observationCoverageVerified !== false || value.forecastIssued !== false) return null;
    if (value.attestation === null) return value.ownerConfirmedHistoricalProfile === false &&
      value.profilePinVerified === false ? value : null;
    return validAttestation(value.attestation, month) &&
      value.ownerConfirmedHistoricalProfile === (value.attestation.action === 'confirm') &&
      value.profilePinVerified === value.attestation.profilePinVerified ? value : null;
  }

  function validateAttestationMutation(value, month, action) {
    return clean(value) && exact(value, ['id', 'revision', 'digest', 'action', 'replayed',
      'profilePinVerified', 'ownerConfirmedHistoricalProfile', 'historicalCalendarVerified',
      'observationCoverageVerified', 'forecastIssued']) && uuid(value.id) &&
      Number.isSafeInteger(value.revision) && value.revision > 0 && DIGEST.test(value.digest || '') &&
      value.action === action && typeof value.replayed === 'boolean' &&
      value.profilePinVerified === (action === 'confirm') &&
      value.ownerConfirmedHistoricalProfile === (action === 'confirm') &&
      value.historicalCalendarVerified === false && value.observationCoverageVerified === false &&
      value.forecastIssued === false ? value : null;
  }

  function validateRetellSnapshot(value, expectedId) {
    if (!clean(value) || !['retell_call_source_recorded', 'retell_call_source_current',
      'source_receipt_stale'].includes(value.state) || !uuid(value.snapshotId) ||
      (expectedId && value.snapshotId !== expectedId)) return null;
    if (value.state === 'source_receipt_stale') {
      var captureStale = exact(value, ['state', 'snapshotId', 'sourceSnapshotDigest',
        'sourceCount', 'replayed', 'reviewedLeadIdentityVerified', 'callerConsentVerified',
        'providerCoverageVerified', 'retentionVerified', 'historicalCoverageVerified',
        'forecastIssued']) && (value.sourceSnapshotDigest === null ||
          DIGEST.test(value.sourceSnapshotDigest || '')) && value.sourceCount === 0 &&
        typeof value.replayed === 'boolean' && value.reviewedLeadIdentityVerified === false &&
        value.callerConsentVerified === false && value.providerCoverageVerified === false &&
        value.retentionVerified === false && value.historicalCoverageVerified === false &&
        value.forecastIssued === false;
      var readStale = exact(value, ['state', 'snapshotId', 'sourceSnapshotDigest', 'sources',
        'refreshRequired', 'reviewedLeadIdentityVerified', 'historicalCoverageVerified',
        'providerCoverageVerified', 'retentionVerified', 'forecastIssued']) &&
        (value.sourceSnapshotDigest === null || DIGEST.test(value.sourceSnapshotDigest || '')) &&
        Array.isArray(value.sources) && value.sources.length === 0 &&
        value.refreshRequired === true && value.reviewedLeadIdentityVerified === false &&
        value.historicalCoverageVerified === false && value.providerCoverageVerified === false &&
        value.retentionVerified === false && value.forecastIssued === false;
      return captureStale || readStale ? value : null;
    }
    if (!DIGEST.test(value.sourceSnapshotDigest || '') ||
      value.reviewedLeadIdentityVerified !== false || value.providerCoverageVerified !== false ||
      value.historicalCoverageVerified !== false || value.forecastIssued !== false) return null;
    if (value.state === 'retell_call_source_recorded') return exact(value,
      ['state', 'snapshotId', 'sourceSnapshotDigest', 'sourceCount', 'replayed',
        'reviewedLeadIdentityVerified', 'callerConsentVerified', 'providerCoverageVerified',
        'retentionVerified', 'historicalCoverageVerified', 'forecastIssued']) &&
        Number.isSafeInteger(value.sourceCount) && value.sourceCount >= 0 && value.sourceCount <= 1000 &&
        typeof value.replayed === 'boolean' ? value : null;
    var ids = new Set();
    return exact(value, ['state', 'snapshotId', 'sourceSnapshotDigest', 'sources',
      'refreshRequired', 'reviewedLeadIdentityVerified', 'historicalCoverageVerified',
      'providerCoverageVerified', 'retentionVerified', 'forecastIssued']) &&
      Array.isArray(value.sources) && value.sources.length <= 1000 &&
      value.sources.every(function (item) { return exact(item,
        ['callSourceId', 'sourceDigest', 'occurredAt', 'recordedAt']) &&
        uuid(item.callSourceId) && !ids.has(item.callSourceId) && (ids.add(item.callSourceId), true) &&
        DIGEST.test(item.sourceDigest || '') &&
        instant(item.occurredAt) && instant(item.recordedAt); }) &&
      value.refreshRequired === false ? value : null;
  }

  function validateRetellReviews(value, snapshotId) {
    if (!clean(value) || !exact(value, ['state', 'snapshotId', 'sourceSnapshotDigest',
      'callCount', 'reviewedCount', 'unresolvedCount', 'calls',
      'historicalCoverageVerified', 'providerCoverageVerified', 'forecastIssued']) ||
      !['call_reviews_complete', 'call_reviews_incomplete', 'source_receipt_stale'].includes(value.state) ||
      value.snapshotId !== snapshotId ||
      !(value.state === 'source_receipt_stale' ?
        (value.sourceSnapshotDigest === null || DIGEST.test(value.sourceSnapshotDigest || '')) :
        DIGEST.test(value.sourceSnapshotDigest || '')) ||
      !Array.isArray(value.calls) || value.calls.length > 1000 ||
      !Number.isSafeInteger(value.callCount) || !Number.isSafeInteger(value.reviewedCount) ||
      !Number.isSafeInteger(value.unresolvedCount) || value.callCount < 0 || value.reviewedCount < 0 ||
      value.unresolvedCount < 0 || value.callCount !== value.calls.length ||
      value.reviewedCount + value.unresolvedCount !== value.callCount ||
      (value.state === 'call_reviews_complete' && value.unresolvedCount !== 0) ||
      (value.state === 'call_reviews_incomplete' && value.unresolvedCount < 1) ||
      (value.state === 'source_receipt_stale' && value.calls.length !== 0) ||
      value.historicalCoverageVerified !== false || value.providerCoverageVerified !== false ||
      value.forecastIssued !== false) return null;
    var callIds = new Set(), reviewedMembers = 0, unresolvedMembers = 0;
    return value.calls.every(function (item) {
      var valid = exact(item,
      ['callSourceId', 'status', 'disposition', 'anchorCallSourceId', 'reviewRevision', 'reviewDigest']) &&
      uuid(item.callSourceId) && !callIds.has(item.callSourceId) &&
      (callIds.add(item.callSourceId), true) && ['reviewed', 'unresolved'].includes(item.status) &&
      Number.isSafeInteger(item.reviewRevision) && item.reviewRevision >= 0 &&
      (item.status === 'reviewed' ?
        (['new_lead', 'repeat_lead', 'not_lead'].includes(item.disposition) &&
         item.reviewRevision > 0 && DIGEST.test(item.reviewDigest || '') &&
         (item.disposition === 'repeat_lead' ? uuid(item.anchorCallSourceId) :
           item.anchorCallSourceId === null)) :
         (item.disposition === null && item.anchorCallSourceId === null &&
          item.reviewRevision === 0 && item.reviewDigest === null));
      if (valid && item.status === 'reviewed') reviewedMembers += 1;
      if (valid && item.status === 'unresolved') unresolvedMembers += 1;
      return valid;
    }) && reviewedMembers === value.reviewedCount &&
      unresolvedMembers === value.unresolvedCount ? value : null;
  }

  function validateRetellReviewMutation(value) {
    return clean(value) && exact(value, ['state', 'reviewId', 'revision', 'digest', 'replayed',
      'providerCoverageVerified', 'historicalCoverageVerified', 'forecastIssued']) &&
      ['call_review_recorded', 'call_review_stale'].includes(value.state) && uuid(value.reviewId) &&
      Number.isSafeInteger(value.revision) && value.revision > 0 && DIGEST.test(value.digest || '') &&
      typeof value.replayed === 'boolean' && value.providerCoverageVerified === false &&
      value.historicalCoverageVerified === false && value.forecastIssued === false ? value : null;
  }

  function describe(value, family) {
    var state = value.state || '';
    if (state === 'not_found') return { tone: 'missing', label: 'Receipt not found', detail: 'Check the exact receipt ID and current workspace.' };
    if (state === 'demand_ui_prerequisites_current') return { tone: 'ready', label: 'Prerequisites loaded', detail: 'Current profile, epoch and human-review tokens were loaded without changing source evidence.' };
    if (state.endsWith('_stale')) return { tone: 'stale', label: 'Refresh required', detail: 'The saved evidence changed. Start a new explicit research action; the old receipt remains historical.' };
    if (state.endsWith('_unavailable')) return { tone: 'missing', label: 'Prerequisite unavailable', detail: reason(value.reason) };
    if (state.includes('_evaluation_') && state.endsWith('_saved')) return { tone: 'ready', label: 'Evaluation saved', detail: 'Post-horizon evidence is saved. Metrics remain private and no calibration or drift verdict is claimed.' };
    if (state.endsWith('_saved')) return { tone: 'ready', label: 'Research origin saved', detail: family + ' is saved for the shown horizon. Numeric output remains private and withheld.' };
    if (state.endsWith('_current')) return { tone: 'ready', label: 'Evidence is current', detail: family + ' remains current for research review. It is not a production forecast.' };
    if (state.endsWith('_recorded')) return { tone: 'ready', label: 'Decision recorded', detail: 'The explicit owner or administrator decision was recorded. No automatic action was taken.' };
    return { tone: 'ready', label: 'Current decision loaded', detail: family + ' is ready for explicit owner or administrator review.' };
  }
  function reason(value) {
    var labels = {
      review_missing: 'An owner or administrator must approve the exact research method first.',
      epoch_missing: 'Create the prospective source epoch after the authenticated source and business profile are ready.',
      source_changed: 'The source changed. Refresh the source evidence, then start a new research action.',
      horizon_not_ended: 'The horizon has not ended yet. Evaluate after its stated end time.',
      insufficient_history: 'The exact bounded source does not yet have enough complete history.',
      prospectively_ineligible: 'The source was activated too late for this research window.',
    };
    return labels[value] || 'The guarded source did not establish the prerequisites for this research action.';
  }

  function create(options) {
    var doc = options.document, mode = options.mode === 'demo' ? 'demo' : 'paid';
    var fetcher = options.fetcher, generation = 0, workspace = options.workspaceAvailable !== false;
    var attempts = Object.create(null), lastUncertain = null, demoTimer = null, demoStage = 0;
    var workspaceIdentity = null;
    var ids = { retell: null, transition: null, transitionEvaluation: null,
      seasonal: null, seasonalEvaluation: null, pipeline: null, pipelineEvaluation: null };
    var prerequisite = null, consent = null, certification = null, transitionReview = null;
    var profileWindow = null, profileAnchor = null, monthAttestation = null;
    var retellSnapshot = null, retellReviews = null;
    var demoSerial = 0, demoStore = newDemoStore();
    function newDemoStore() {
      return { originsById: Object.create(null), evaluationsById: Object.create(null),
        currentOrigins: Object.create(null), currentEvaluations: Object.create(null),
        reviews: { transition: null }, reviewHistory: [], stale: false };
    }
    function node(id) { return doc.getElementById(id); }
    function setText(id, text) { var target = node(id); if (target) target.textContent = text; }
    function setHidden(id, hidden) { var target = node(id); if (target) target.hidden = hidden; }
    function status(slot, model) {
      var target = node('commandCenterResearch' + slot);
      if (!target) return;
      target.dataset.tone = model.tone;
      target.replaceChildren();
      var strong = doc.createElement('strong'), detail = doc.createElement('span');
      strong.textContent = model.label; detail.textContent = model.detail;
      target.append(strong, detail);
    }
    function storeId(name, value) {
      ids[name] = value || null;
      var input = node('commandCenterResearch' + name.charAt(0).toUpperCase() + name.slice(1) + 'Id');
      if (input && value) input.value = value;
    }
    function requestFingerprint(config, bodyText) {
      return [workspaceIdentity || 'workspace-unavailable', config.name, config.url, bodyText].join('\n');
    }
    function keyFor(config, bodyText) {
      var fingerprint = requestFingerprint(config, bodyText), current = attempts[config.name];
      if (!current || current.fingerprint !== fingerprint) {
        current = { fingerprint: fingerprint, key: options.idempotency() };
        attempts[config.name] = current;
      }
      return current;
    }
    function confirmed(name, fingerprint) {
      if (attempts[name] && attempts[name].fingerprint === fingerprint) delete attempts[name];
      lastUncertain = null;
    }
    function readId(name) {
      var input = node('commandCenterResearch' + name.charAt(0).toUpperCase() + name.slice(1) + 'Id');
      var value = String(input && input.value || '').trim().toLowerCase();
      return UUID.test(value) ? value : null;
    }
    function readMonth() {
      var value = String(node('commandCenterResearchHorizon').value || '').trim();
      return MONTH.test(value) ? value : null;
    }
    function setupMonth() {
      var value = String(node('commandCenterResearchCertificationMonth').value || '').trim();
      return MONTH.test(value) ? value : null;
    }
    function decisionReason() {
      var value = String(node('commandCenterResearchDecisionReason').value || '').trim();
      return value.length >= 10 && value.length <= 1000 ? value : null;
    }
    function errorModel(response, body) {
      var category = body && body.error && body.error.category;
      if (response && response.status === 403) return { tone: 'restricted', label: 'Owner or administrator access required', detail: 'This workspace session cannot use this private research action.' };
      if (response && response.status === 409) return { tone: 'stale', label: 'Source changed', detail: 'Refresh the prerequisite source or review and start a new explicit action.' };
      if (response && response.status === 400) return { tone: 'missing', label: 'Check the request', detail: 'Use an exact receipt ID, supported horizon, and current review token.' };
      if (category && /OVERSIZED|BOUND/.test(category)) return { tone: 'missing', label: 'Review limit exceeded', detail: 'The complete bounded set is too large. No partial research result was used.' };
      return { tone: 'error', label: 'Research request unavailable', detail: 'Retry the same action. No result is assumed.' };
    }
    function request(config, retryAttempt) {
      if (mode === 'demo' || !workspace) return Promise.resolve(null);
      var bodyText = JSON.stringify(config.body || {});
      var attempt = config.write ? (retryAttempt || keyFor(config, bodyText)) : null;
      var fingerprint = config.write ? attempt.fingerprint : requestFingerprint(config, bodyText);
      var key = config.write ? attempt.key : null;
      var current = ++generation;
      status(config.slot, { tone: 'loading', label: 'Checking source', detail: 'Results remain withheld until the guarded response is verified.' });
      var settings = { method: config.write ? 'POST' : 'GET', cache: 'no-store', headers: { Accept: 'application/json' } };
      if (config.write) {
        settings.headers['Content-Type'] = 'application/json'; settings.headers['Idempotency-Key'] = key;
        settings.body = bodyText;
      }
      lastUncertain = { config: Object.assign({}, config, { body: JSON.parse(bodyText) }),
        key: key, fingerprint: fingerprint };
      return fetcher(config.url, settings).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (body) {
          if (current !== generation || !workspace || mode !== 'paid') return null;
          var data = response.ok ? envelope(body) : null;
          var value = data && config.validate(data);
          if (!response.ok || !value) {
            if (!response.ok && response.status < 500) {
              if (attempts[config.name] && attempts[config.name].fingerprint === fingerprint) {
                delete attempts[config.name];
              }
              lastUncertain = null;
            }
            status(config.slot, errorModel(response, body)); return null;
          }
          if (config.expectedId && value.id && value.id !== config.expectedId) {
            status(config.slot, { tone: 'error', label: 'Receipt mismatch', detail: 'The response did not match the requested receipt. Nothing is shown.' });
            return null;
          }
          confirmed(config.name, fingerprint);
          if (config.store && value.id) storeId(config.store, value.id);
          if (config.storeEvaluation && value.id) storeId(config.storeEvaluation, value.id);
          var presentation = config.onValue ? config.onValue(value) : null;
          status(config.slot, presentation || describe(value, config.family));
          return value;
        });
      }).catch(function () {
        if (current !== generation || !workspace || mode !== 'paid') return null;
        status(config.slot, { tone: 'error', label: 'Connection interrupted', detail: 'Retry preserves the exact action identity; no result is assumed.' });
        return null;
      });
    }
    function invalid(slot, message) {
      status(slot, { tone: 'missing', label: 'More information required', detail: message });
      return Promise.resolve(null);
    }
    function action(name) {
      if (mode === 'demo') return demoAction(name);
      if (name === 'profile-window-load') {
        var profileMonth = setupMonth();
        if (!profileMonth) return invalid('Setup', 'Choose the first day of one completed local month.');
        return request({ name: name, slot: 'Setup', family: 'Current business profile', write: false,
          url: '/api/v1/forecast/reporting-windows?localStartDate=' +
            encodeURIComponent(profileMonth) + '&grain=month',
          validate: function (value) { return validateProfileWindow(value, profileMonth); },
          onValue: function (value) { profileWindow = value; } });
      }
      if (name === 'profile-anchor-capture') {
        var anchorReason = decisionReason();
        if (!anchorReason) return invalid('Setup', 'Enter a profile-source reason of at least 10 characters.');
        return request({ name: name, slot: 'Setup', family: 'Prospective profile source', write: true,
          url: '/api/v1/forecast/reporting-windows/effective-anchors',
          body: { reason: anchorReason, confirmed: true }, validate: validateProfileAnchor,
          onValue: function (value) { if (value.anchorId) {
            profileAnchor = value.anchorId;
            node('commandCenterResearchProfileAnchorId').value = value.anchorId;
          } } });
      }
      if (name === 'profile-anchor-activate') {
        var anchorId = String(node('commandCenterResearchProfileAnchorId').value || '').trim().toLowerCase();
        if (!uuid(anchorId)) return invalid('Setup', 'Capture or enter the exact profile anchor receipt first.');
        return request({ name: name, slot: 'Setup', family: 'Prospective profile source', write: true,
          url: '/api/v1/forecast/reporting-windows/effective-anchors/' + encodeURIComponent(anchorId) + '/activate',
          body: {}, validate: function (value) { return validateProfileAnchor(value, anchorId); },
          onValue: function () { profileAnchor = anchorId; prerequisite = null; } });
      }
      if (name === 'month-attestation-load') {
        var attestationMonth = setupMonth();
        if (!attestationMonth) return invalid('Setup', 'Choose the first day of one completed local month.');
        return request({ name: name, slot: 'Setup', family: 'Historical profile applicability', write: false,
          url: '/api/v1/forecast/reporting-windows/month-attestations?localStartDate=' +
            encodeURIComponent(attestationMonth),
          validate: function (value) { return validateAttestationRead(value, attestationMonth); },
          onValue: function (value) { monthAttestation = value; } });
      }
      if (name === 'month-attestation-confirm' || name === 'month-attestation-revoke') {
        var month = setupMonth(), monthAction = name.endsWith('confirm') ? 'confirm' : 'revoke';
        var monthReason = decisionReason();
        if (!month || !profileWindow || profileWindow.window.localStartDate !== month ||
            !monthAttestation) return invalid('Setup', 'Check the current month profile and attestation before recording this decision.');
        if (!monthReason) return invalid('Setup', 'Enter a month-profile reason of at least 10 characters.');
        var priorAttestation = monthAttestation.attestation;
        return request({ name: name, slot: 'Setup', family: 'Historical profile applicability', write: true,
          url: '/api/v1/forecast/reporting-windows/month-attestations', body: {
            localStartDate: month, action: monthAction,
            businessProfileId: profileWindow.window.businessProfileId,
            businessProfileHash: profileWindow.window.businessProfileHash,
            expectedRevision: priorAttestation ? priorAttestation.revision : 0,
            expectedDigest: priorAttestation ? priorAttestation.digest : null,
            reason: monthReason, confirmed: true, confirmationVersion: 'forecast-calendar-review-v1' },
          validate: function (value) { return validateAttestationMutation(value, month, monthAction); },
          onValue: function () { monthAttestation = null; } });
      }
      if (name === 'retell-snapshot-capture') {
        return request({ name: name, slot: 'Setup', family: 'Current Retell call source', write: true,
          url: '/api/v1/forecast/demand-sources/retell/snapshots', body: {},
          validate: validateRetellSnapshot, onValue: function (value) {
            if (value.snapshotId) node('commandCenterResearchRetellSnapshotId').value = value.snapshotId;
            retellSnapshot = value; retellReviews = null;
          } });
      }
      if (name === 'retell-snapshot-load') {
        var snapshotId = String(node('commandCenterResearchRetellSnapshotId').value || '').trim().toLowerCase();
        if (!uuid(snapshotId)) return invalid('Setup', 'Capture or enter the exact Retell call snapshot first.');
        return request({ name: name, slot: 'Setup', family: 'Current Retell call source', write: false,
          url: '/api/v1/forecast/demand-sources/retell/snapshots/' + encodeURIComponent(snapshotId),
          validate: function (value) { return validateRetellSnapshot(value, snapshotId); },
          onValue: function (value) { retellSnapshot = value; retellReviews = null; } });
      }
      if (name === 'retell-reviews-load') {
        var reviewSnapshotId = String(node('commandCenterResearchRetellSnapshotId').value || '').trim().toLowerCase();
        if (!uuid(reviewSnapshotId)) return invalid('Setup', 'Load the exact Retell call snapshot before reviewing calls.');
        return request({ name: name, slot: 'Setup', family: 'Retell call reviews', write: false,
          url: '/api/v1/forecast/demand-sources/retell/snapshots/' + encodeURIComponent(reviewSnapshotId) + '/reviews',
          validate: function (value) { return validateRetellReviews(value, reviewSnapshotId); },
          onValue: function (value) { retellReviews = value;
            var first = value.calls.find(function (item) { return item.status === 'unresolved'; });
            if (first) node('commandCenterResearchRetellCallSourceId').value = first.callSourceId;
          } });
      }
      if (name === 'retell-review-save') {
        var sourceSnapshotId = String(node('commandCenterResearchRetellSnapshotId').value || '').trim().toLowerCase();
        var sourceId = String(node('commandCenterResearchRetellCallSourceId').value || '').trim().toLowerCase();
        var disposition = String(node('commandCenterResearchRetellDisposition').value || '');
        var repeatId = String(node('commandCenterResearchRetellAnchorCallId').value || '').trim().toLowerCase();
        var reviewReason = decisionReason();
        var source = retellSnapshot && Array.isArray(retellSnapshot.sources) &&
          retellSnapshot.sources.find(function (item) { return item.callSourceId === sourceId; });
        var review = retellReviews && retellReviews.calls.find(function (item) { return item.callSourceId === sourceId; });
        if (!uuid(sourceSnapshotId) || !uuid(sourceId) || !source || !review) {
          return invalid('Setup', 'Load the call snapshot and current reviews, then choose an exact call source.');
        }
        if (!reviewReason || (disposition === 'repeat_lead' ? !uuid(repeatId) : repeatId !== '')) {
          return invalid('Setup', 'Enter a review reason and a valid earlier call only for a repeat lead.');
        }
        return request({ name: name, slot: 'Setup', family: 'Retell call review', write: true,
          url: '/api/v1/forecast/demand-sources/retell/snapshots/' + encodeURIComponent(sourceSnapshotId) +
            '/reviews/' + encodeURIComponent(sourceId), body: {
              expectedSourceDigest: source.sourceDigest, expectedRevision: review.reviewRevision,
              expectedDigest: review.reviewDigest || 'none', disposition: disposition,
              anchorCallSourceId: disposition === 'repeat_lead' ? repeatId : null,
              reason: reviewReason, confirmed: true,
              confirmationVersion: 'm26-retell-call-review-v1' },
          validate: validateRetellReviewMutation,
          onValue: function () { retellReviews = null; } });
      }
      if (name === 'prerequisites-load') return request({ name: name, slot: 'Setup',
        family: 'Demand research prerequisites', write: false,
        url: '/api/v1/forecast/demand-to-schedule/prerequisites/current',
        validate: validatePrerequisites, onValue: function (value) {
          prerequisite = value;
          return { tone: value.profile.state === 'current' ? 'ready' : 'missing',
            label: value.profile.state === 'current' ? 'Prerequisites loaded' : 'Current profile anchor unavailable',
            detail: 'Seasonal method ' + (value.seasonal.method.approved ? 'approved' : 'not approved') +
              '; epoch ' + value.seasonal.epoch.state + '. Pipeline method ' +
              (value.pipeline.method.approved ? 'approved' : 'not approved') + '; epoch ' +
              value.pipeline.epoch.state + '.' };
        } });
      if (name === 'consent-load') return request({ name: name, slot: 'Setup',
        family: 'Retell research permission', write: false,
        url: '/api/v1/forecast/demand-sources/retell/consent', validate: validateConsent,
        onValue: function (value) { consent = value; return {
          tone: value.active ? 'ready' : 'missing',
          label: value.active ? 'Retell research permission active' : 'Retell research permission inactive',
          detail: value.current ? 'Current explicit decision revision ' + value.current.revision + '.' :
            'No explicit company permission decision has been recorded.' }; } });
      if (name === 'consent-grant' || name === 'consent-revoke') {
        if (!consent) return invalid('Setup', 'Check current Retell permission before recording a decision.');
        var consentReason = decisionReason(); if (!consentReason) return invalid('Setup', 'Enter a reason of at least 10 characters.');
        var consentAction = name.endsWith('grant') ? 'grant' : 'revoke';
        return request({ name: name, slot: 'Setup', family: 'Retell research permission', write: true,
          url: '/api/v1/forecast/demand-sources/retell/consent', body: { action: consentAction,
            expectedRevision: consent.current ? consent.current.revision : 0,
            expectedDigest: consent.current ? consent.current.digest : 'none', reason: consentReason,
            confirmed: true, confirmationVersion: 'm26-retell-demand-source-consent-v1' },
          validate: validateConsentMutation, onValue: function () { consent = null; } });
      }
      if (name === 'epoch-seasonal' || name === 'epoch-pipeline') {
        if (!prerequisite || prerequisite.profile.state !== 'current') return invalid('Setup', 'Check prerequisites and establish a current prospective business-profile anchor first.');
        var epochPurpose = name.endsWith('seasonal') ? 'seasonal_inbound' : 'pipeline_first_booking';
        return request({ name: name, slot: 'Setup', family: 'Prospective source epoch', write: true,
          url: '/api/v1/forecast/demand-to-schedule/epochs', body: { purpose: epochPurpose,
            profileAnchorId: prerequisite.profile.anchorId },
          validate: function (value) { return validateEpoch(value, epochPurpose); },
          onValue: function () { prerequisite = null; } });
      }
      if (name.indexOf('method-seasonal-') === 0 || name.indexOf('method-pipeline-') === 0) {
        if (!prerequisite) return invalid('Setup', 'Check current prerequisites before recording a method decision.');
        var methodPurpose = name.indexOf('method-seasonal-') === 0 ? 'seasonal_inbound' : 'pipeline_first_booking';
        var methodAction = name.endsWith('approve') ? 'approve' : 'reject';
        var methodToken = methodPurpose === 'seasonal_inbound' ? prerequisite.seasonal.method : prerequisite.pipeline.method;
        var methodReason = decisionReason(); if (!methodReason) return invalid('Setup', 'Enter a reason of at least 10 characters.');
        return request({ name: name, slot: 'Setup', family: 'Research method review', write: true,
          url: '/api/v1/forecast/demand-to-schedule/method-reviews', body: {
            purpose: methodPurpose, action: methodAction,
            expectedRevision: methodToken.expectedRevision, expectedDigest: methodToken.expectedDigest,
            reason: methodReason, confirmed: true,
            confirmationVersion: 'm26-demand-schedule-method-review-v1' },
          validate: function (value) { return validateMethodMutation(value, methodPurpose, methodAction); },
          onValue: function () { prerequisite = null; } });
      }
      if (name === 'period-snapshot') {
        var snapshotMonth = setupMonth(); if (!snapshotMonth) return invalid('Setup', 'Choose the first day of one completed local month.');
        return request({ name: name, slot: 'Setup', family: 'Monthly Retell source', write: true,
          url: '/api/v1/forecast/demand-sources/retell/period-snapshots', body: { localMonthStart: snapshotMonth },
          validate: function (value) { return validatePeriodSnapshot(value, snapshotMonth); }, onValue: function (value) {
            if (value.snapshotId) {
              node('commandCenterResearchPeriodSnapshotId').value = value.snapshotId;
              node('commandCenterResearchRetellSnapshotId').value = value.snapshotId;
              retellSnapshot = periodReviewSnapshot(value); retellReviews = null;
            }
            return value.snapshotId ? { tone: 'loading', label: 'Month source saved',
              detail: 'Loading the exact calls and current human-review state for this completed month.' } : null;
          } }).then(function (value) {
            if (!value || value.state !== 'retell_period_snapshot_saved') return value;
            return action('retell-reviews-load').then(function () { return value; });
          });
      }
      if (name === 'certification-load') {
        var certificationMonth = setupMonth(); if (!certificationMonth) return invalid('Setup', 'Choose the first day of one completed local month.');
        return request({ name: name, slot: 'Setup', family: 'Monthly Retell certification', write: false,
          url: '/api/v1/forecast/demand-sources/retell/period-certifications/' + encodeURIComponent(certificationMonth),
          validate: function (value) { return validateCertification(value, certificationMonth); },
          onValue: function (value) { certification = value;
            if (value.snapshotId) node('commandCenterResearchPeriodSnapshotId').value = value.snapshotId; } });
      }
      if (name === 'certification-certify' || name === 'certification-revoke') {
        var certMonth = setupMonth(), certSnapshot = String(node('commandCenterResearchPeriodSnapshotId').value || '').trim().toLowerCase();
        var certReason = decisionReason(), certAction = name.endsWith('certify') ? 'certify' : 'revoke';
        if (!certMonth || !uuid(certSnapshot) || !certification) return invalid('Setup', 'Check the current certification and use its exact month and snapshot receipt.');
        if (!certReason) return invalid('Setup', 'Enter a reason of at least 10 characters.');
        return request({ name: name, slot: 'Setup', family: 'Monthly Retell certification', write: true,
          url: '/api/v1/forecast/demand-sources/retell/period-certifications', body: {
            action: certAction, snapshotId: certSnapshot, localMonthStart: certMonth,
            expectedRevision: certification.expectedRevision, expectedDigest: certification.expectedDigest,
            callerConsentAttested: certAction === 'certify',
            providerCoverageAttested: certAction === 'certify', retentionAttested: certAction === 'certify',
            reason: certReason, confirmed: true, confirmationVersion: 'm26-retell-period-certification-v2' },
          validate: function (value) {
            return clean(value) && exact(value, ['state', 'id', 'revision', 'digest', 'replayed',
              'localMonthStart', 'scope', 'callerConsentAttested', 'providerCoverageAttested',
              'retentionAttested', 'providerIndependentVerified', 'wholeBusinessCoverageVerified',
              'forecastIssued', 'paidNumericServing']) &&
              value.state === (certAction === 'certify' ? 'retell_period_certified' : 'retell_period_revoked') &&
              uuid(value.id) && Number.isSafeInteger(value.revision) && value.revision > 0 &&
              DIGEST.test(value.digest || '') && typeof value.replayed === 'boolean' &&
              value.localMonthStart === certMonth && value.scope === 'retell_only_tenant_all' &&
              value.callerConsentAttested === (certAction === 'certify') &&
              value.providerCoverageAttested === (certAction === 'certify') &&
              value.retentionAttested === (certAction === 'certify') &&
              value.providerIndependentVerified === false && value.wholeBusinessCoverageVerified === false &&
              value.forecastIssued === false && value.paidNumericServing === false ? value : null;
          }, onValue: function () { certification = null; } });
      }
      if (name === 'retell-save') {
        var horizon = readMonth(); if (!horizon) return invalid('Inbound', 'Choose the first day of a future local month.');
        return request({ name: name, slot: 'Inbound', family: 'Inbound demand research', write: true,
          url: '/api/v1/forecast/demand-sources/retell/future-origins', body: { localHorizonStart: horizon },
          validate: validateRetell, store: 'retell' });
      }
      if (name === 'retell-load') {
        var retellId = readId('retell'); if (!retellId) return invalid('Inbound', 'Enter the exact inbound origin receipt ID.');
        return request({ name: name, slot: 'Inbound', family: 'Inbound demand research', write: false,
          url: '/api/v1/forecast/demand-sources/retell/future-origins/' + encodeURIComponent(retellId),
          expectedId: retellId, validate: function (value) { return validateRetell(value, retellId); } });
      }
      if (name === 'transition-review') return request({ name: name, slot: 'Transitions', family: 'Transition method review', write: false,
        url: '/api/v1/forecast/demand-sources/transitions/method-reviews/current', validate: validateTransitionReview,
        onValue: function (value) { transitionReview = value; } });
      if (name === 'transition-review-approve' || name === 'transition-review-reject') {
        if (!transitionReview) return invalid('Transitions', 'Check the current method review before recording a decision.');
        var transitionReason = decisionReason(); if (!transitionReason) return invalid('Transitions', 'Enter a setup decision reason of at least 10 characters.');
        var transitionAction = name.endsWith('approve') ? 'approve' : 'reject';
        var expectedRevision = transitionReview.state === 'transition_method_review_unavailable' ? 0 : transitionReview.revision;
        var expectedDigest = transitionReview.state === 'transition_method_review_unavailable' ? 'none' : transitionReview.reviewDigest;
        return request({ name: name, slot: 'Transitions', family: 'Transition method review', write: true,
          url: '/api/v1/forecast/demand-sources/transitions/method-reviews', body: {
            action: transitionAction, expectedRevision: expectedRevision, expectedDigest: expectedDigest,
            reason: transitionReason, confirmed: true,
            confirmationVersion: 'm26-transition-method-review-v2' },
          validate: function (value) {
            return validateTransitionReviewMutation(value, transitionAction);
          }, onValue: function () { transitionReview = null; } });
      }
      if (name === 'transition-save') return request({ name: name, slot: 'Transitions', family: 'Transition evidence', write: true,
        url: '/api/v1/forecast/demand-sources/transitions/future-origins', body: {}, validate: validateTransitionOrigin, store: 'transition' });
      if (name === 'transition-load') {
        var transitionId = readId('transition'); if (!transitionId) return invalid('Transitions', 'Enter the exact transition origin receipt ID.');
        return request({ name: name, slot: 'Transitions', family: 'Transition evidence', write: false,
          url: '/api/v1/forecast/demand-sources/transitions/future-origins/' + encodeURIComponent(transitionId), expectedId: transitionId,
          validate: function (value) { return validateTransitionOrigin(value, transitionId); } });
      }
      if (name === 'transition-evaluate') {
        var transitionOrigin = readId('transition'); if (!transitionOrigin) return invalid('Transitions', 'Load the exact transition origin before evaluation.');
        return request({ name: name, slot: 'Transitions', family: 'Transition evaluation', write: true,
          url: '/api/v1/forecast/demand-sources/transitions/future-origins/' + encodeURIComponent(transitionOrigin) + '/evaluations', body: {},
          validate: function (value) { return validateTransitionEvaluation(value, transitionOrigin); }, storeEvaluation: 'transitionEvaluation' });
      }
      if (name === 'transition-evaluation-load') {
        var transitionEvaluationId = readId('transitionEvaluation'), transitionEvaluationOrigin = readId('transition');
        if (!transitionEvaluationId || !transitionEvaluationOrigin) return invalid('Transitions', 'Enter both the exact transition origin and evaluation receipt IDs.');
        return request({ name: name, slot: 'Transitions', family: 'Transition evaluation', write: false,
          url: '/api/v1/forecast/demand-sources/transitions/evaluations/' + encodeURIComponent(transitionEvaluationId),
          expectedId: transitionEvaluationId,
          validate: function (value) { return validateTransitionEvaluation(value, transitionEvaluationOrigin, transitionEvaluationId); } });
      }
      if (name === 'seasonal-save') {
        var month = readMonth(); if (!month) return invalid('Seasonal', 'Choose the first day of a future local month.');
        return request({ name: name, slot: 'Seasonal', family: 'Seasonal research', write: true,
          url: '/api/v1/forecast/demand-to-schedule/seasonal-origins', body: { horizonMonth: month },
          validate: function (value) { return validateDemandOrigin(value, 'seasonal'); }, store: 'seasonal' });
      }
      if (name === 'seasonal-load') {
        var seasonalId = readId('seasonal'); if (!seasonalId) return invalid('Seasonal', 'Enter the exact seasonal origin receipt ID.');
        return request({ name: name, slot: 'Seasonal', family: 'Seasonal research', write: false,
          url: '/api/v1/forecast/demand-to-schedule/seasonal-origins/' + encodeURIComponent(seasonalId), expectedId: seasonalId,
          validate: function (value) { return validateDemandOrigin(value, 'seasonal', seasonalId); } });
      }
      if (name === 'seasonal-evaluate') {
        var seasonalOrigin = readId('seasonal'); if (!seasonalOrigin) return invalid('Seasonal', 'Load the exact seasonal origin before evaluation.');
        return request({ name: name, slot: 'Seasonal', family: 'Seasonal evaluation', write: true,
          url: '/api/v1/forecast/demand-to-schedule/seasonal-origins/' + encodeURIComponent(seasonalOrigin) + '/evaluations', body: {},
          validate: function (value) { return validateDemandEvaluation(value, 'seasonal', seasonalOrigin); }, storeEvaluation: 'seasonalEvaluation' });
      }
      if (name === 'seasonal-evaluation-load') {
        var seasonalEvaluationId = readId('seasonalEvaluation'), seasonalEvaluationOrigin = readId('seasonal');
        if (!seasonalEvaluationId || !seasonalEvaluationOrigin) return invalid('Seasonal', 'Enter both the exact seasonal origin and evaluation receipt IDs.');
        return request({ name: name, slot: 'Seasonal', family: 'Seasonal evaluation', write: false,
          url: '/api/v1/forecast/demand-to-schedule/seasonal-evaluations/' + encodeURIComponent(seasonalEvaluationId),
          expectedId: seasonalEvaluationId,
          validate: function (value) { return validateDemandEvaluation(value, 'seasonal', seasonalEvaluationOrigin, seasonalEvaluationId); } });
      }
      if (name === 'pipeline-save') return request({ name: name, slot: 'Pipeline', family: 'Pipeline research', write: true,
        url: '/api/v1/forecast/demand-to-schedule/pipeline-origins', body: {},
        validate: function (value) { return validateDemandOrigin(value, 'pipeline'); }, store: 'pipeline' });
      if (name === 'pipeline-load') {
        var pipelineId = readId('pipeline'); if (!pipelineId) return invalid('Pipeline', 'Enter the exact pipeline origin receipt ID.');
        return request({ name: name, slot: 'Pipeline', family: 'Pipeline research', write: false,
          url: '/api/v1/forecast/demand-to-schedule/pipeline-origins/' + encodeURIComponent(pipelineId), expectedId: pipelineId,
          validate: function (value) { return validateDemandOrigin(value, 'pipeline', pipelineId); } });
      }
      if (name === 'pipeline-evaluate') {
        var pipelineOrigin = readId('pipeline'); if (!pipelineOrigin) return invalid('Pipeline', 'Load the exact pipeline origin before evaluation.');
        return request({ name: name, slot: 'Pipeline', family: 'Pipeline evaluation', write: true,
          url: '/api/v1/forecast/demand-to-schedule/pipeline-origins/' + encodeURIComponent(pipelineOrigin) + '/evaluations', body: {},
          validate: function (value) { return validateDemandEvaluation(value, 'pipeline', pipelineOrigin); }, storeEvaluation: 'pipelineEvaluation' });
      }
      if (name === 'pipeline-evaluation-load') {
        var pipelineEvaluationId = readId('pipelineEvaluation'), pipelineEvaluationOrigin = readId('pipeline');
        if (!pipelineEvaluationId || !pipelineEvaluationOrigin) return invalid('Pipeline', 'Enter both the exact pipeline origin and evaluation receipt IDs.');
        return request({ name: name, slot: 'Pipeline', family: 'Pipeline evaluation', write: false,
          url: '/api/v1/forecast/demand-to-schedule/pipeline-evaluations/' + encodeURIComponent(pipelineEvaluationId),
          expectedId: pipelineEvaluationId,
          validate: function (value) { return validateDemandEvaluation(value, 'pipeline', pipelineEvaluationOrigin, pipelineEvaluationId); } });
      }
      return Promise.resolve(null);
    }
    function retry() {
      if (!lastUncertain || mode !== 'paid') return Promise.resolve(null);
      var preserved = attempts[lastUncertain.config.name];
      if (lastUncertain.config.write && (!preserved || preserved.key !== lastUncertain.key ||
          preserved.fingerprint !== lastUncertain.fingerprint)) return Promise.resolve(null);
      return request(lastUncertain.config, lastUncertain.config.write ? preserved : null);
    }
    function demoId(kind) {
      demoSerial += 1;
      var source = String(workspaceIdentity || 'isolated-demo') + ':' + kind + ':' + demoSerial;
      var value = 2166136261;
      for (var index = 0; index < source.length; index += 1) {
        value ^= source.charCodeAt(index); value = Math.imul(value, 16777619) >>> 0;
      }
      var tail = (value.toString(16).padStart(8, '0') + demoSerial.toString(16).padStart(4, '0')).slice(-12);
      return 'de000000-0000-4000-8000-' + tail;
    }
    function demoFamily(name) {
      if (name.indexOf('retell-') === 0) return 'retell';
      if (name.indexOf('transition-') === 0) return 'transition';
      if (name.indexOf('seasonal-') === 0) return 'seasonal';
      if (name.indexOf('pipeline-') === 0) return 'pipeline';
      return null;
    }
    function demoSlot(family) {
      return { retell: 'Inbound', transition: 'Transitions', seasonal: 'Seasonal',
        pipeline: 'Pipeline' }[family];
    }
    function currentTransitionReview() {
      var review = demoStore.reviews.transition;
      return review && review.action === 'approve' ? review : null;
    }
    function transitionOriginCurrent(origin) {
      var review = currentTransitionReview();
      return !!(origin && origin.family === 'transition' && !origin.stale && review &&
        origin.reviewId === review.id && origin.reviewRevision === review.revision);
    }
    function staleTransitionHistory() {
      var changed = false;
      Object.keys(demoStore.originsById).forEach(function (originId) {
        var origin = demoStore.originsById[originId];
        if (origin.family === 'transition' && !origin.stale) { origin.stale = true; changed = true; }
      });
      if (changed) { demoStore.stale = true; demoStage = 3; }
      return changed;
    }
    function demoAction(name) {
      var family = demoFamily(name), slot = demoSlot(family);
      if (!family || !slot) return Promise.resolve(null);
      if (name === 'transition-review') {
        var currentReview = demoStore.reviews.transition;
        status(slot, { tone: currentReview && currentReview.action === 'approve' ? 'ready' : 'missing',
          label: currentReview ? (currentReview.action === 'approve' ?
            'Fictional method approved' : 'Fictional method rejected') : 'Fictional method review required',
          detail: currentReview ? 'This explicit fictional decision is isolated to the current demo session.' :
            'Choose Approve method or Reject method before saving transition research.' });
        return Promise.resolve(currentReview ? Object.assign({}, currentReview) : null);
      }
      if (name === 'transition-review-approve' || name === 'transition-review-reject') {
        var reviewAction = name.endsWith('approve') ? 'approve' : 'reject';
        var hadCurrentTransition = staleTransitionHistory();
        var demoReview = { id: demoId('transition-review'), family: 'transition',
          action: reviewAction, revision: demoStore.reviewHistory.length + 1,
          workspaceIdentity: workspaceIdentity };
        demoStore.reviews.transition = demoReview; demoStore.reviewHistory.push(demoReview);
        status(slot, { tone: reviewAction === 'approve' ? 'ready' : 'missing',
          label: reviewAction === 'approve' ? 'Fictional method approved' : 'Fictional method rejected',
          detail: reviewAction === 'approve' ?
            'The explicit fictional review now permits a local transition research receipt.' :
             'Transition research remains unavailable until a later explicit fictional approval.' });
        if (hadCurrentTransition) demoPaint();
        return Promise.resolve(Object.assign({}, demoReview));
      }
      if (name.endsWith('-save')) {
        if (family === 'transition' && (!demoStore.reviews.transition ||
            demoStore.reviews.transition.action !== 'approve')) {
          return invalid(slot, 'Approve the fictional transition method before saving an origin.');
        }
        var origin = { id: demoId(family + '-origin'), family: family, stale: false,
          savedAt: demoSerial, workspaceIdentity: workspaceIdentity };
        if (family === 'transition') {
          origin.reviewId = demoStore.reviews.transition.id;
          origin.reviewRevision = demoStore.reviews.transition.revision;
        }
        demoStore.originsById[origin.id] = origin; demoStore.currentOrigins[family] = origin.id;
        demoStore.stale = false;
        storeId(family === 'retell' ? 'retell' : family, origin.id);
        status(slot, { tone: 'ready', label: 'Fictional origin saved',
          detail: 'An immutable illustrative receipt was saved in this demo session. No paid source was contacted.' });
        return Promise.resolve(Object.assign({}, origin));
      }
      if (name.endsWith('-load') && name.indexOf('evaluation') < 0) {
        var requestedOrigin = readId(family === 'retell' ? 'retell' : family);
        var storedOrigin = demoStore.originsById[requestedOrigin];
        if (!storedOrigin || storedOrigin.family !== family) {
          return invalid(slot, 'That fictional receipt is not present in this current demo session.');
        }
        status(slot, { tone: storedOrigin.stale ? 'stale' : 'ready',
          label: storedOrigin.stale ? 'Fictional receipt is stale' : 'Fictional origin loaded',
          detail: storedOrigin.stale ? 'Recover with a new explicit fictional origin; the old receipt remains historical.' :
            'The exact isolated receipt was loaded. Private illustrative output remains withheld.' });
        return Promise.resolve(Object.assign({}, storedOrigin));
      }
      if (name.endsWith('-evaluate')) {
        if (family === 'retell') return invalid(slot, 'Inbound source research has no Part 4A evaluation authority.');
        var originId = readId(family), selected = demoStore.originsById[originId];
        if (!selected || selected.family !== family || selected.stale ||
            (family === 'transition' && !transitionOriginCurrent(selected))) {
          return invalid(slot, 'Load one current fictional origin before recording its later evaluation.');
        }
        var evaluation = { id: demoId(family + '-evaluation'), originId: originId,
          family: family, savedAt: demoSerial, workspaceIdentity: workspaceIdentity };
        demoStore.evaluationsById[evaluation.id] = evaluation;
        demoStore.currentEvaluations[family] = evaluation.id;
        storeId(family + 'Evaluation', evaluation.id);
        status(slot, { tone: 'ready', label: 'Fictional evaluation saved',
          detail: 'A linked illustrative post-horizon receipt was saved locally. No metric, calibration or drift verdict is claimed.' });
        return Promise.resolve(Object.assign({}, evaluation));
      }
      if (name.endsWith('-evaluation-load')) {
        var requestedEvaluation = readId(family + 'Evaluation'), requestedParent = readId(family);
        var storedEvaluation = demoStore.evaluationsById[requestedEvaluation];
        var storedParent = demoStore.originsById[requestedParent];
        if (!storedEvaluation || storedEvaluation.family !== family ||
            storedEvaluation.originId !== requestedParent) {
          return invalid(slot, 'Enter the exact linked fictional origin and evaluation receipt IDs from this demo session.');
        }
        status(slot, { tone: storedParent && storedParent.stale ? 'stale' : 'ready',
          label: storedParent && storedParent.stale ? 'Fictional evaluation is stale' : 'Fictional evaluation loaded',
          detail: storedParent && storedParent.stale ? 'The fictional source changed. Save and evaluate a new origin.' :
            'The exact linked evaluation was loaded without exposing a private numeric result.' });
        return Promise.resolve(Object.assign({}, storedEvaluation));
      }
      return Promise.resolve(null);
    }
    function demoSaveAll() {
      ['retell', 'transition', 'seasonal', 'pipeline'].forEach(function (family) {
        var origin = { id: demoId(family + '-origin'), family: family, stale: false,
          savedAt: demoSerial, workspaceIdentity: workspaceIdentity };
        if (family === 'transition') {
          var review = currentTransitionReview();
          origin.reviewId = review.id; origin.reviewRevision = review.revision;
        }
        demoStore.originsById[origin.id] = origin; demoStore.currentOrigins[family] = origin.id;
        storeId(family, origin.id);
      });
      demoStore.currentEvaluations = Object.create(null); demoStore.stale = false;
    }
    function demoEvaluateAll() {
      var families = ['transition', 'seasonal', 'pipeline'];
      var transition = demoStore.originsById[demoStore.currentOrigins.transition];
      if (!transitionOriginCurrent(transition) || families.some(function (family) {
        var origin = demoStore.originsById[demoStore.currentOrigins[family]];
        return !origin || origin.stale;
      })) {
        status('Transitions', { tone: 'stale', label: 'Fictional review or origin changed',
          detail: 'Approve the current fictional method and recover with a new origin before evaluation.' });
        return false;
      }
      families.forEach(function (family) {
        var origin = demoStore.originsById[demoStore.currentOrigins[family]];
        if (!origin) return;
        var evaluation = { id: demoId(family + '-evaluation'), originId: origin.id,
          family: family, savedAt: demoSerial, workspaceIdentity: workspaceIdentity };
        demoStore.evaluationsById[evaluation.id] = evaluation;
        demoStore.currentEvaluations[family] = evaluation.id;
        storeId(family + 'Evaluation', evaluation.id);
      });
      return true;
    }
    function demoMakeStale() {
      Object.keys(demoStore.originsById).forEach(function (originId) {
        demoStore.originsById[originId].stale = true;
      });
      demoStore.stale = true;
    }
    function demoPaint() {
      var states = [
        ['Ready to explore', 'Choose “Start fictional research” to save an illustrative origin. No paid source is contacted.'],
        ['Fictional origins saved', 'The demo now shows isolated inbound, transition, seasonal and first-booking research origins. Private values remain withheld.'],
        ['Fictional evaluations ready', 'The illustrative horizons ended and evaluations were recorded locally. No calibration or drift verdict is claimed.'],
        ['Fictional source changed', 'The illustrative saved evidence is stale. Recover by starting new fictional origins; the old demo receipts remain historical.'],
        ['Recovered with new origins', 'New fictional origins replaced the stale current selection. Earlier receipts remain immutable demo history.'],
      ];
      var current = states[demoStage];
      ['Inbound', 'Transitions', 'Seasonal', 'Pipeline'].forEach(function (slot) {
        status(slot, { tone: demoStage === 3 ? 'stale' : demoStage === 0 ? 'missing' : 'ready', label: current[0], detail: current[1] });
      });
      setText('commandCenterDemandState', demoStage === 0 ? 'Fictional research ready' : current[0]);
      setText('commandCenterDemandExplanation', current[1]);
      setText('commandCenterDemandBoundary',
        'Fictional isolated demo only. Current backlog stays separate. This demo does not issue a production forecast or commercial action.');
      setText('commandCenterResearchDemoAction', demoStage === 0 ? 'Start fictional research' :
        demoStage === 1 ? 'Advance fictional horizon' : demoStage === 2 ? 'Simulate source change' :
          demoStage === 3 ? 'Recover with new origins' : 'Advance recovered horizon');
    }
    function demoAdvance() {
      generation += 1;
      if (demoStage === 0) {
        if (!currentTransitionReview()) {
          status('Transitions', { tone: 'missing', label: 'Fictional method review required',
            detail: 'Choose Approve method before starting the complete fictional research journey.' });
          return;
        }
        demoSaveAll(); demoStage = 1;
      }
      else if (demoStage === 1) { if (!demoEvaluateAll()) return; demoStage = 2; }
      else if (demoStage === 2) { demoMakeStale(); demoStage = 3; }
      else if (demoStage === 3) {
        if (!currentTransitionReview()) {
          status('Transitions', { tone: 'missing', label: 'Fictional method review required',
            detail: 'Approve the current fictional method before recovering with new origins.' });
          return;
        }
        demoSaveAll(); demoStage = 4;
      } else { if (!demoEvaluateAll()) return; demoStage = 2; }
      demoPaint();
    }
    function demoReset() {
      generation += 1; demoStage = 0;
      if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
      clearPrivateState();
      demoPaint();
    }
    function bind() {
      var actions = node('commandCenterResearchRoot') || node('commandCenterResearchActions');
      if (actions) actions.addEventListener('click', function (event) {
        var button = event.target.closest ? event.target.closest('[data-demand-research-action]') : null;
        if (button) action(button.getAttribute('data-demand-research-action'));
      });
      var retryButton = node('commandCenterResearchRetry'); if (retryButton) retryButton.addEventListener('click', retry);
      var demoAction = node('commandCenterResearchDemoAction'); if (demoAction) demoAction.addEventListener('click', demoAdvance);
      var demoResetButton = node('commandCenterResearchDemoReset'); if (demoResetButton) demoResetButton.addEventListener('click', demoReset);
    }
    function workspaceUnavailable() {
      workspace = false; generation += 1; clearPrivateState();
      ['Inbound', 'Transitions', 'Seasonal', 'Pipeline'].forEach(function (slot) {
        status(slot, { tone: 'error', label: 'Workspace unavailable', detail: 'Refresh the workspace before using this private research action.' });
      });
    }
    function clearPrivateState() {
      ids = { retell: null, transition: null, transitionEvaluation: null,
        seasonal: null, seasonalEvaluation: null, pipeline: null, pipelineEvaluation: null };
      attempts = Object.create(null); lastUncertain = null; prerequisite = null;
      consent = null; certification = null; transitionReview = null;
      profileWindow = null; profileAnchor = null; monthAttestation = null;
      retellSnapshot = null; retellReviews = null;
      demoStore = newDemoStore();
      ['Retell', 'Transition', 'TransitionEvaluation', 'Seasonal', 'SeasonalEvaluation',
        'Pipeline', 'PipelineEvaluation'].forEach(function (name) {
        var input = node('commandCenterResearch' + name + 'Id'); if (input) input.value = '';
      });
      ['ProfileAnchor', 'RetellSnapshot', 'RetellCallSource', 'RetellAnchorCall',
        'PeriodSnapshot'].forEach(function (name) {
        var input = node('commandCenterResearch' + name + 'Id'); if (input) input.value = '';
      });
    }
    function workspaceReady(identity) {
      if (typeof identity === 'string' && identity && workspaceIdentity !== identity) {
        generation += 1; clearPrivateState();
        if (mode === 'demo') demoStage = 0;
        workspaceIdentity = identity;
      }
      workspace = true;
      if (mode === 'demo') demoPaint();
    }
    function destroy() {
      generation += 1; workspace = false;
      if (demoTimer) clearTimeout(demoTimer);
    }
    bind();
    setHidden('commandCenterResearchPaid', mode === 'demo');
    setHidden('commandCenterResearchDemo', mode !== 'demo');
    setHidden('commandCenterResearchRetry', mode === 'demo');
    if (mode === 'demo') demoPaint();
    else if (!workspace) workspaceUnavailable();
    return { action: action, retry: retry, workspaceUnavailable: workspaceUnavailable,
      workspaceReady: workspaceReady, demoAdvance: demoAdvance, demoReset: demoReset,
      destroy: destroy, ids: function () { return Object.assign({}, ids); } };
  }

  return Object.freeze({ validateRetell: validateRetell,
    validateTransitionReview: validateTransitionReview,
    validateTransitionReviewMutation: validateTransitionReviewMutation,
    validateTransitionOrigin: validateTransitionOrigin,
    validateTransitionEvaluation: validateTransitionEvaluation,
    validateDemandOrigin: validateDemandOrigin,
    validateDemandEvaluation: validateDemandEvaluation,
    validatePrerequisites: validatePrerequisites, validateConsent: validateConsent,
    validatePeriodSnapshot: validatePeriodSnapshot, validateCertification: validateCertification,
    validateProfileWindow: validateProfileWindow, validateProfileAnchor: validateProfileAnchor,
    validateAttestationRead: validateAttestationRead,
    validateRetellSnapshot: validateRetellSnapshot, validateRetellReviews: validateRetellReviews,
    envelope: envelope, create: create });
});
