(function (global) {
  'use strict';

  var MONEY = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
  var INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
  var REASONS = [
    'reporting_currency_unavailable', 'period_attribution_unavailable',
    'current_owner_confirmed_booking_unavailable',
    'current_adopted_material_plan_unavailable', 'current_material_price_unavailable',
    'reported_material_availability_unavailable',
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
      'scope', 'work', 'plannedMaterials', 'purchasing', 'availability',
      'inventoryValuation', 'learnedOutcomes', 'forecastIssued',
      'completePurchasingForecastIssued', 'inventoryForecastIssued',
      'calibratedRangeIssued', 'probabilityIssued', 'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-material-cost-forecast-v1' ||
        ['current', 'unavailable'].indexOf(value.state) < 0 || typeof value.fictional !== 'boolean' ||
        !instant(value.checkedAt) || !exact(value.horizon, ['startsAt', 'endsAt', 'days']) ||
        !instant(value.horizon.startsAt) || !instant(value.horizon.endsAt) ||
        value.horizon.days !== 30 || new Date(value.horizon.endsAt).getTime() -
          new Date(value.horizon.startsAt).getTime() !== 2592000000 ||
        !exact(value.scope, ['label', 'wholeBusinessCoverageVerified',
          'offPlatformCoverageVerified']) || value.scope.wholeBusinessCoverageVerified !== false ||
        value.scope.offPlatformCoverageVerified !== false ||
        !exact(value.work, ['state', 'scheduledCount', 'unscheduledCount', 'outsideWindowCount']) ||
        !exact(value.plannedMaterials, ['state', 'coveredCount', 'lineCount', 'baseCost',
          'wasteCost', 'lineCost', 'reason']) ||
        !exact(value.purchasing, ['state', 'basis', 'purchaseOrdersVerified',
          'deliveryFeesIncluded', 'taxTreatmentVerified', 'transportIncluded', 'reason']) ||
        value.purchasing.basis !== 'owner_adopted_m24_material_plan' ||
        value.purchasing.purchaseOrdersVerified !== false ||
        value.purchasing.deliveryFeesIncluded !== false ||
        value.purchasing.taxTreatmentVerified !== false || value.purchasing.transportIncluded !== false ||
        !exact(value.availability, ['state', 'reportedSufficientLineCount',
          'inventoryVerified', 'reservationVerified', 'supplierAuthenticated', 'reason']) ||
        value.availability.inventoryVerified !== false || value.availability.reservationVerified !== false ||
        value.availability.supplierAuthenticated !== false ||
        !exact(value.inventoryValuation, ['state', 'amount', 'reason']) ||
        value.inventoryValuation.state !== 'unavailable' || value.inventoryValuation.amount !== null ||
        value.inventoryValuation.reason !== 'inventory_records_unavailable' ||
        !exact(value.learnedOutcomes, ['state', 'applicableServiceCount', 'applied', 'reason']) ||
        value.learnedOutcomes.applied !== false ||
        value.completePurchasingForecastIssued !== false || value.inventoryForecastIssued !== false ||
        value.calibratedRangeIssued !== false || value.probabilityIssued !== false ||
        value.automaticActionAuthorized !== false) return null;
    if (value.state === 'unavailable') {
      return REASONS.indexOf(value.reason) >= 0 && value.currency === null &&
        value.forecastIssued === false && value.work.state === 'unavailable' &&
        value.work.scheduledCount === null && value.work.unscheduledCount === null &&
        value.work.outsideWindowCount === null && value.plannedMaterials.state === 'unavailable' &&
        value.plannedMaterials.coveredCount === null && value.plannedMaterials.lineCount === null &&
        value.plannedMaterials.baseCost === null && value.plannedMaterials.wasteCost === null &&
        value.plannedMaterials.lineCost === null && value.plannedMaterials.reason === value.reason &&
        value.purchasing.state === 'unavailable' && value.purchasing.reason === value.reason &&
        value.availability.state === 'unavailable' &&
        value.availability.reportedSufficientLineCount === null &&
        value.availability.reason === value.reason && value.learnedOutcomes.state === 'unavailable' &&
        value.learnedOutcomes.applicableServiceCount === null &&
        value.learnedOutcomes.reason === value.reason ? value : null;
    }
    if (value.reason !== null || value.forecastIssued !== true ||
        !/^[A-Z]{3}$/.test(value.currency || '') || value.work.state !== 'current' ||
        ![value.work.scheduledCount, value.work.unscheduledCount,
          value.work.outsideWindowCount].every(function (count) {
          return Number.isSafeInteger(count) && count >= 0 && count <= 500;
        }) || value.plannedMaterials.state !== 'current' ||
        !Number.isSafeInteger(value.plannedMaterials.coveredCount) ||
        value.plannedMaterials.coveredCount !== value.work.scheduledCount ||
        !Number.isSafeInteger(value.plannedMaterials.lineCount) ||
        value.plannedMaterials.lineCount < 0 || value.plannedMaterials.lineCount > 10000 ||
        ![value.plannedMaterials.baseCost, value.plannedMaterials.wasteCost,
          value.plannedMaterials.lineCost].every(function (amount) { return MONEY.test(amount || ''); }) ||
        value.plannedMaterials.reason !== null || value.purchasing.state !== 'plan_cost_only' ||
        value.purchasing.reason !== 'purchase_terms_unavailable' ||
        value.availability.state !== 'owner_recorded_reported_sufficient' ||
        value.availability.reportedSufficientLineCount !== value.plannedMaterials.lineCount ||
        value.availability.reason !== 'reported_availability_is_not_reserved_inventory' ||
        value.learnedOutcomes.state !== 'none_current' ||
        value.learnedOutcomes.applicableServiceCount !== 0 ||
        value.learnedOutcomes.reason !== 'no_current_applicable_owner_adopted_multiplier') return null;
    return value;
  }
  function demoForecast() {
    return {
      version: 'm26-material-cost-forecast-v1', state: 'current', reason: null,
      fictional: true, checkedAt: '2026-10-07T12:00:00.000Z', currency: 'USD',
      horizon: { startsAt: '2026-10-07T12:00:00.000Z', endsAt: '2026-11-06T12:00:00.000Z', days: 30 },
      scope: { label: 'Fictional next 30-day scheduled backlog',
        wholeBusinessCoverageVerified: false, offPlatformCoverageVerified: false },
      work: { state: 'current', scheduledCount: 3, unscheduledCount: 1, outsideWindowCount: 2 },
      plannedMaterials: { state: 'current', coveredCount: 3, lineCount: 8,
        baseCost: '3900.00', wasteCost: '325.00', lineCost: '4225.00', reason: null },
      purchasing: { state: 'plan_cost_only', basis: 'owner_adopted_m24_material_plan',
        purchaseOrdersVerified: false, deliveryFeesIncluded: false,
        taxTreatmentVerified: false, transportIncluded: false,
        reason: 'purchase_terms_unavailable' },
      availability: { state: 'owner_recorded_reported_sufficient',
        reportedSufficientLineCount: 8, inventoryVerified: false,
        reservationVerified: false, supplierAuthenticated: false,
        reason: 'reported_availability_is_not_reserved_inventory' },
      inventoryValuation: { state: 'unavailable', amount: null,
        reason: 'inventory_records_unavailable' },
      learnedOutcomes: { state: 'none_current', applicableServiceCount: 0, applied: false,
        reason: 'no_current_applicable_owner_adopted_multiplier' },
      forecastIssued: true, completePurchasingForecastIssued: false,
      inventoryForecastIssued: false, calibratedRangeIssued: false,
      probabilityIssued: false, automaticActionAuthorized: false,
    };
  }
  function create(options) {
    var document = options.document;
    var generation = 0;
    function id(name) { return document.getElementById(name); }
    function money(value, currency) {
      var parts = value.split('.');
      var rounded = BigInt(parts[0]) + (BigInt(parts[1]) >= 50n ? 1n : 0n);
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency,
        minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(rounded));
    }
    function announce(value, context) {
      var message = 'Next 30-day planned material cost: ' + value +
        (/[.!?]$/.test(value) ? ' ' : '. ') + context;
      var status = id('commandCenterMaterialForecastStatus');
      if (status.textContent !== message) status.textContent = message;
    }
    function loading() {
      var value = 'Checking adopted material plans and reported availability.';
      var context = 'Waiting for current evidence.';
      id('commandCenterMaterialForecast').textContent = value;
      id('commandCenterMaterialForecastContext').textContent = '';
      announce(value, context);
    }
    function unavailable(value) {
      var result = 'Not available';
      var context = value && value.reason === 'learned_adjustment_compatibility_unverified' ?
        'A current learned-material adjustment exists, but this plan does not prove whether it already includes that adjustment.' :
        'The exact booked-work, adopted-plan, price, or reported-availability evidence is incomplete.';
      id('commandCenterMaterialForecast').textContent = result;
      id('commandCenterMaterialForecastContext').textContent = context;
      announce(result, context);
    }
    function render(value) {
      var safe = validate(value);
      if (!safe || safe.state !== 'current') { unavailable(safe); return; }
      var result = money(safe.plannedMaterials.lineCost, safe.currency) +
        ' across ' + safe.plannedMaterials.lineCount +
        (safe.plannedMaterials.lineCount === 1 ? ' planned line' : ' planned lines');
      var context = safe.work.scheduledCount +
        (safe.work.scheduledCount === 1 ? ' scheduled job' : ' scheduled jobs') +
        ' in the next 30 days, including ' + money(safe.plannedMaterials.wasteCost, safe.currency) +
        ' of planned waste. Prices and availability are owner-recorded; orders, reserved stock, fees, tax, delivery, and supplier authentication are not verified.';
      id('commandCenterMaterialForecast').textContent = result;
      id('commandCenterMaterialForecastContext').textContent = context;
      announce(result, context);
    }
    function load() {
      var run = ++generation;
      loading();
      if (options.mode === 'demo') { render(demoForecast()); return Promise.resolve(); }
      return options.fetcher('/api/v1/forecast/material-cost/current', {
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
  global.NorthStarMaterialCostForecast = {
    create: create, demoForecast: demoForecast, validate: validate,
  };
})(window);
