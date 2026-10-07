(function (global) {
  'use strict';
  var MONEY = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
  var REASONS = ['reporting_profile_unavailable', 'owner_recorded_schedule_coverage_unavailable',
    'owner_recorded_schedule_coverage_stale', 'schedule_currency_conflict',
    'schedule_source_currentness_unavailable'];
  function exact(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === keys.length && keys.every(function (key) {
        return Object.prototype.hasOwnProperty.call(value, key);
      });
  }
  function instant(value) {
    return typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) &&
      Number.isFinite(Date.parse(value));
  }
  function count(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 12000; }
  function validate(value) {
    var keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'currency', 'horizon',
      'scope', 'overhead', 'financedAssetCash', 'evidence', 'allocation', 'forecastIssued',
      'completeOperatingCostForecastIssued', 'calibratedRangeIssued', 'probabilityIssued',
      'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-overhead-cash-forecast-v1' ||
        ['current', 'unavailable'].indexOf(value.state) < 0 || typeof value.fictional !== 'boolean' ||
        !instant(value.checkedAt) || !exact(value.horizon, ['startsAt', 'endsAt', 'days']) ||
        !instant(value.horizon.startsAt) || !instant(value.horizon.endsAt) || value.horizon.days !== 30 ||
        Date.parse(value.horizon.endsAt) - Date.parse(value.horizon.startsAt) !== 2592000000 ||
        !exact(value.scope, ['label', 'wholeBusinessCoverageVerified', 'offPlatformCoverageVerified']) ||
        value.scope.label !== 'Next 30 days of owner-recorded company obligations' ||
        value.scope.offPlatformCoverageVerified !== false ||
        !exact(value.overhead, ['state', 'amount', 'dueCount', 'scheduleCount', 'reason']) ||
        !exact(value.financedAssetCash, ['state', 'amount', 'dueCount', 'obligationCount',
          'ownerMarkedSatisfiedCount', 'canceledCount', 'reason']) ||
        !exact(value.evidence, ['ownerRecordedSchedules', 'exactAmounts', 'exactDueDates',
          'recurrenceEndRecorded', 'sourceAttested', 'currentRevision', 'completeAsOf',
          'overlapReconciled', 'actualPaymentVerified', 'learnedAdjustmentApplied']) ||
        !exact(value.allocation, ['state', 'basis', 'jobCostAllocationIncluded',
          'economicDepreciationIncluded', 'actualPaymentClaimed', 'reason']) ||
        value.allocation.basis !== 'owner_approved_schedule_policy' ||
        value.allocation.jobCostAllocationIncluded !== false ||
        value.allocation.economicDepreciationIncluded !== false ||
        value.allocation.actualPaymentClaimed !== false || value.evidence.actualPaymentVerified !== false ||
        value.evidence.learnedAdjustmentApplied !== false ||
        value.completeOperatingCostForecastIssued !== false || value.calibratedRangeIssued !== false ||
        value.probabilityIssued !== false || value.automaticActionAuthorized !== false) return null;
    if (value.state === 'unavailable') {
      return REASONS.indexOf(value.reason) >= 0 && value.currency === null &&
        value.scope.wholeBusinessCoverageVerified === false && value.forecastIssued === false &&
        value.overhead.state === 'unavailable' && value.overhead.amount === null &&
        value.overhead.dueCount === null && value.overhead.scheduleCount === null &&
        value.overhead.reason === value.reason && value.financedAssetCash.state === 'unavailable' &&
        ['amount', 'dueCount', 'obligationCount', 'ownerMarkedSatisfiedCount', 'canceledCount']
          .every(function (key) { return value.financedAssetCash[key] === null; }) &&
        value.financedAssetCash.reason === value.reason && value.allocation.state === 'unavailable' &&
        value.allocation.reason === value.reason && Object.keys(value.evidence)
          .every(function (key) { return value.evidence[key] === false; }) ? value : null;
    }
    return value.reason === null && /^[A-Z]{3}$/.test(value.currency || '') &&
      value.scope.wholeBusinessCoverageVerified === true && value.overhead.state === 'current' &&
      MONEY.test(value.overhead.amount || '') && count(value.overhead.dueCount) &&
      count(value.overhead.scheduleCount) && value.overhead.reason === null &&
      value.financedAssetCash.state === 'current' && MONEY.test(value.financedAssetCash.amount || '') &&
      [value.financedAssetCash.dueCount, value.financedAssetCash.obligationCount,
        value.financedAssetCash.ownerMarkedSatisfiedCount, value.financedAssetCash.canceledCount]
        .every(count) && value.financedAssetCash.reason === null && value.allocation.state === 'reconciled' &&
      value.allocation.reason ===
        'dated_cash_commitments_kept_separate_from_job_cost_and_economic_recovery' &&
      ['ownerRecordedSchedules', 'exactAmounts', 'exactDueDates', 'recurrenceEndRecorded',
        'sourceAttested', 'currentRevision', 'completeAsOf', 'overlapReconciled']
        .every(function (key) { return value.evidence[key] === true; }) && value.forecastIssued === true ? value : null;
  }
  function demoForecast() {
    return {
      version: 'm26-overhead-cash-forecast-v1', state: 'current', reason: null, fictional: true,
      checkedAt: '2026-10-07T12:00:00.000Z', currency: 'USD',
      horizon: { startsAt: '2026-10-07T12:00:00.000Z', endsAt: '2026-11-06T12:00:00.000Z', days: 30 },
      scope: { label: 'Next 30 days of owner-recorded company obligations',
        wholeBusinessCoverageVerified: true, offPlatformCoverageVerified: false },
      overhead: { state: 'current', amount: '3200.00', dueCount: 3, scheduleCount: 3, reason: null },
      financedAssetCash: { state: 'current', amount: '1150.00', dueCount: 1,
        obligationCount: 1, ownerMarkedSatisfiedCount: 1, canceledCount: 0, reason: null },
      evidence: { ownerRecordedSchedules: true, exactAmounts: true, exactDueDates: true,
        recurrenceEndRecorded: true, sourceAttested: true, currentRevision: true,
        completeAsOf: true, overlapReconciled: true, actualPaymentVerified: false,
        learnedAdjustmentApplied: false },
      allocation: { state: 'reconciled', basis: 'owner_approved_schedule_policy',
        jobCostAllocationIncluded: false, economicDepreciationIncluded: false,
        actualPaymentClaimed: false,
        reason: 'dated_cash_commitments_kept_separate_from_job_cost_and_economic_recovery' },
      forecastIssued: true, completeOperatingCostForecastIssued: false,
      calibratedRangeIssued: false, probabilityIssued: false, automaticActionAuthorized: false,
    };
  }
  function create(options) {
    var document = options.document; var generation = 0;
    function id(name) { return document.getElementById(name); }
    function money(value, currency) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency,
        minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(value));
    }
    function announce(value, context) {
      var message = 'Next 30-day overhead and financed-asset cash: ' + value +
        (/[.!?]$/.test(value) ? ' ' : '. ') + context;
      var status = id('commandCenterOverheadCashForecastStatus');
      if (status.textContent !== message) status.textContent = message;
    }
    function loading() {
      var value = 'Checking owner-recorded company obligation schedules.';
      id('commandCenterOverheadCashForecast').textContent = value;
      id('commandCenterOverheadCashForecastContext').textContent = '';
      announce(value, 'Waiting for current source coverage and allocation review.');
    }
    function unavailable(value) {
      var result = 'Not available';
      var context = value && value.reason === 'schedule_currency_conflict' ?
        'The schedule currency does not match the current Business Profile.' :
        'A current complete owner-recorded schedule, source attestation, due-date coverage, asset record, or overlap review is missing.';
      id('commandCenterOverheadCashForecast').textContent = result;
      id('commandCenterOverheadCashForecastContext').textContent = context;
      announce(result, context);
    }
    function render(value) {
      var safe = validate(value);
      if (!safe || safe.state !== 'current') { unavailable(safe); return; }
      var result = money(safe.overhead.amount, safe.currency) + ' overhead + ' +
        money(safe.financedAssetCash.amount, safe.currency) + ' dated asset cash';
      var context = (safe.overhead.dueCount + safe.financedAssetCash.dueCount) +
        ' scheduled due dates from the current complete owner-recorded set. Job-cost allocation and economic depreciation stay separate. Owner-marked satisfied dates are not proof of payment; off-platform coverage, learned adjustments, probability, and calibrated ranges are not claimed.';
      id('commandCenterOverheadCashForecast').textContent = result;
      id('commandCenterOverheadCashForecastContext').textContent = context;
      announce(result, context);
    }
    function load() {
      var run = ++generation; loading();
      if (options.mode === 'demo') { render(demoForecast()); return Promise.resolve(); }
      return options.fetcher('/api/v1/forecast/overhead-cash/current', {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (payload) {
          if (run !== generation) return;
          if (!response.ok || !payload || payload.success !== true) throw new Error('unavailable');
          render(payload.data);
        });
      }).catch(function () { if (run === generation) unavailable(); });
    }
    return { workspaceReady: load, workspaceUnavailable: function () { generation += 1; unavailable(); } };
  }
  global.NorthStarOverheadCashForecast = { create: create, demoForecast: demoForecast, validate: validate };
})(window);
