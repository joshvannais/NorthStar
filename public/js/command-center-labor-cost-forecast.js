(function (global) {
  'use strict';

  var MONEY = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
  var HOURS = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{6}$/;
  var INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
  var REASONS = [
    'reporting_currency_unavailable', 'declared_capacity_evidence_unavailable',
    'period_attribution_unavailable', 'current_adopted_labor_plan_unavailable',
    'authorized_rate_or_burden_unavailable', 'rate_or_work_source_applicability_unavailable',
    'planned_person_time_exceeds_declared_capacity_commitment',
    'learned_adjustment_compatibility_unverified',
  ];

  function exact(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === keys.length && keys.every(function (key) {
        return Object.prototype.hasOwnProperty.call(value, key);
      });
  }
  function instant(value) {
    if (typeof value !== 'string' || !INSTANT.test(value) || /T24:|:60(?:\.|Z)/.test(value)) return false;
    var date = new Date(value);
    var parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    return Number.isFinite(date.getTime()) && date.getUTCFullYear() === Number(parts[1]) &&
      date.getUTCMonth() + 1 === Number(parts[2]) && date.getUTCDate() === Number(parts[3]) &&
      date.getUTCHours() === Number(parts[4]) && date.getUTCMinutes() === Number(parts[5]) &&
      date.getUTCSeconds() === Number(parts[6]);
  }
  function validate(value) {
    var keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'currency', 'horizon',
      'scope', 'work', 'plannedLabor', 'rateAuthority', 'capacity', 'learnedOutcomes',
      'forecastIssued', 'calibratedRangeIssued', 'probabilityIssued',
      'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-labor-cost-forecast-v1' ||
        ['current', 'unavailable'].indexOf(value.state) < 0 || typeof value.fictional !== 'boolean' ||
        !instant(value.checkedAt) || !exact(value.horizon, ['startsAt', 'endsAt', 'days']) ||
        !instant(value.horizon.startsAt) || !instant(value.horizon.endsAt) ||
        value.horizon.days !== 30 || new Date(value.horizon.endsAt).getTime() -
          new Date(value.horizon.startsAt).getTime() !== 2592000000 ||
        !exact(value.scope, ['label', 'wholeBusinessCoverageVerified',
          'offPlatformCoverageVerified']) ||
        value.scope.wholeBusinessCoverageVerified !== false ||
        value.scope.offPlatformCoverageVerified !== false ||
        !exact(value.work, ['state', 'scheduledCount', 'unscheduledCount', 'outsideWindowCount']) ||
        !exact(value.plannedLabor, ['state', 'coveredCount', 'personHours', 'cost', 'reason']) ||
        !exact(value.rateAuthority, ['state', 'basis', 'payrollVerified', 'reason']) ||
        value.rateAuthority.basis !== 'owner_saved_m24_labor_plan_rates' ||
        value.rateAuthority.payrollVerified !== false ||
        !exact(value.capacity, ['state', 'declaredRole', 'realizedAttendanceVerified',
          'jobSpecificConstraintCompositionAvailable', 'reason']) ||
        value.capacity.realizedAttendanceVerified !== false ||
        value.capacity.jobSpecificConstraintCompositionAvailable !== false ||
        !exact(value.learnedOutcomes,
          ['state', 'applicableServiceCount', 'applied', 'reason']) ||
        value.learnedOutcomes.applied !== false || value.calibratedRangeIssued !== false ||
        value.probabilityIssued !== false || value.automaticActionAuthorized !== false) return null;
    if (value.state === 'unavailable') {
      return REASONS.indexOf(value.reason) >= 0 && value.currency === null &&
        value.forecastIssued === false && value.work.state === 'unavailable' &&
        value.work.scheduledCount === null && value.work.unscheduledCount === null &&
        value.work.outsideWindowCount === null && value.plannedLabor.state === 'unavailable' &&
        value.plannedLabor.coveredCount === null && value.plannedLabor.personHours === null &&
        value.plannedLabor.cost === null && value.plannedLabor.reason === value.reason &&
        value.rateAuthority.state === 'unavailable' && value.rateAuthority.reason === value.reason &&
        value.capacity.state === 'unavailable' && value.capacity.declaredRole === null &&
        value.capacity.reason === value.reason && value.learnedOutcomes.state === 'unavailable' &&
        value.learnedOutcomes.applicableServiceCount === null &&
        value.learnedOutcomes.reason === value.reason ? value : null;
    }
    if (value.reason !== null || value.forecastIssued !== true ||
        !/^[A-Z]{3}$/.test(value.currency || '') || value.work.state !== 'current' ||
        ![value.work.scheduledCount, value.work.unscheduledCount,
          value.work.outsideWindowCount].every(function (count) {
          return Number.isSafeInteger(count) && count >= 0 && count <= 500;
        }) || value.plannedLabor.state !== 'current' ||
        !Number.isSafeInteger(value.plannedLabor.coveredCount) ||
        value.plannedLabor.coveredCount !== value.work.scheduledCount ||
        !HOURS.test(value.plannedLabor.personHours || '') ||
        !MONEY.test(value.plannedLabor.cost || '') || value.plannedLabor.reason !== null ||
        value.rateAuthority.state !== 'current' || value.rateAuthority.reason !== null ||
        value.capacity.state !== 'declared_role_capacity_verified' ||
        typeof value.capacity.declaredRole !== 'string' ||
        !/^[a-z][a-z0-9_-]{1,47}$/.test(value.capacity.declaredRole) ||
        value.capacity.reason !== null || value.learnedOutcomes.state !== 'none_current' ||
        value.learnedOutcomes.applicableServiceCount !== 0 ||
        value.learnedOutcomes.reason !== 'no_current_applicable_owner_adopted_multiplier') return null;
    return value;
  }

  function demoForecast() {
    return {
      version: 'm26-labor-cost-forecast-v1', state: 'current', reason: null,
      fictional: true, checkedAt: '2026-10-06T12:00:00.000Z', currency: 'USD',
      horizon: { startsAt: '2026-10-06T12:00:00.000Z', endsAt: '2026-11-05T12:00:00.000Z', days: 30 },
      scope: { label: 'Fictional next 30-day scheduled backlog',
        wholeBusinessCoverageVerified: false, offPlatformCoverageVerified: false },
      work: { state: 'current', scheduledCount: 3, unscheduledCount: 1, outsideWindowCount: 2 },
      plannedLabor: { state: 'current', coveredCount: 3, personHours: '96.000000',
        cost: '4320.00', reason: null },
      rateAuthority: { state: 'current', basis: 'owner_saved_m24_labor_plan_rates',
        payrollVerified: false, reason: null },
      capacity: { state: 'declared_role_capacity_verified', declaredRole: 'technician',
        realizedAttendanceVerified: false, jobSpecificConstraintCompositionAvailable: false,
        reason: null },
      learnedOutcomes: { state: 'none_current', applicableServiceCount: 0, applied: false,
        reason: 'no_current_applicable_owner_adopted_multiplier' },
      forecastIssued: true, calibratedRangeIssued: false, probabilityIssued: false,
      automaticActionAuthorized: false,
    };
  }

  function create(options) {
    var document = options.document;
    var generation = 0;
    function id(name) { return document.getElementById(name); }
    function money(value, currency) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency,
        minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(value));
    }
    function loading() {
      id('commandCenterLaborForecast').textContent = 'Checking planned work, rates, and capacity.';
      id('commandCenterLaborForecastContext').textContent = '';
    }
    function unavailable(value) {
      id('commandCenterLaborForecast').textContent = 'Not available';
      id('commandCenterLaborForecastContext').textContent = value &&
        value.reason === 'learned_adjustment_compatibility_unverified' ?
        'A current learned-hours adjustment exists, but this labor plan does not prove whether it already includes that adjustment.' :
        'The exact scheduled-work, rate, period, or declared-capacity evidence is incomplete.';
    }
    function render(value) {
      var safe = validate(value);
      if (!safe || safe.state !== 'current') { unavailable(safe); return; }
      var hours = Number(safe.plannedLabor.personHours);
      id('commandCenterLaborForecast').textContent = money(safe.plannedLabor.cost, safe.currency) +
        ' for ' + hours.toLocaleString([], { maximumFractionDigits: 1 }) +
        (hours === 1 ? ' planned hour' : ' planned hours');
      id('commandCenterLaborForecastContext').textContent = safe.work.scheduledCount +
        (safe.work.scheduledCount === 1 ? ' scheduled job' : ' scheduled jobs') +
        ' in the next 30 days. Owner-saved rates and declared ' + safe.capacity.declaredRole +
        ' availability only; payroll, attendance, whole-business coverage, probability, and calibrated ranges are not verified.';
    }
    function load() {
      var run = ++generation;
      loading();
      if (options.mode === 'demo') { render(demoForecast()); return Promise.resolve(); }
      return options.fetcher('/api/v1/forecast/labor-cost/current', {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json' },
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (payload) {
          if (run !== generation) return;
          if (!response.ok || !payload || payload.success !== true) throw new Error('unavailable');
          render(payload.data);
        });
      }).catch(function () { if (run === generation) unavailable(); });
    }
    return { workspaceReady: load, workspaceUnavailable: function () {
      generation += 1; unavailable();
    } };
  }

  global.NorthStarLaborCostForecast = {
    create: create, demoForecast: demoForecast, validate: validate,
  };
})(window);
