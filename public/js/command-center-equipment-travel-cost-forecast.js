(function (global) {
  'use strict';

  var MONEY = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
  var INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
  var REASONS = [
    'reporting_currency_unavailable', 'period_attribution_unavailable',
    'current_owner_confirmed_booking_unavailable',
    'current_adopted_equipment_travel_plan_unavailable',
    'current_equipment_travel_source_unavailable',
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
  function count(value, maximum) {
    return Number.isSafeInteger(value) && value >= 0 && value <= (maximum || 10000);
  }
  function validate(value) {
    var keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'currency', 'horizon',
      'scope', 'work', 'plannedEquipmentTravel', 'allocation', 'operations', 'learnedOutcomes',
      'forecastIssued', 'completeOperatingCostForecastIssued', 'downtimeForecastIssued',
      'calibratedRangeIssued', 'probabilityIssued', 'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-equipment-travel-cost-forecast-v1' ||
        ['current', 'unavailable'].indexOf(value.state) < 0 || typeof value.fictional !== 'boolean' ||
        !instant(value.checkedAt) || !exact(value.horizon, ['startsAt', 'endsAt', 'days']) ||
        !instant(value.horizon.startsAt) || !instant(value.horizon.endsAt) ||
        value.horizon.days !== 30 || new Date(value.horizon.endsAt).getTime() -
          new Date(value.horizon.startsAt).getTime() !== 2592000000 ||
        !exact(value.scope, ['label', 'wholeBusinessCoverageVerified', 'offPlatformCoverageVerified']) ||
        value.scope.wholeBusinessCoverageVerified !== false || value.scope.offPlatformCoverageVerified !== false ||
        !exact(value.work, ['state', 'scheduledCount', 'unscheduledCount', 'outsideWindowCount']) ||
        !exact(value.plannedEquipmentTravel, ['state', 'coveredCount', 'equipmentLineCount',
          'tripCount', 'logisticsLineCount', 'equipmentCost', 'grossTravelCost',
          'overlapDeduction', 'netTravelCost', 'combinedCost', 'reason']) ||
        !exact(value.allocation, ['state', 'basis', 'v3AllocationReviewed',
          'crossForecastLaborOverlapReviewed', 'reason']) ||
        value.allocation.basis !== 'owner_adopted_m24_cost_allocation_v3' ||
        !exact(value.operations, ['state', 'fuelOrEnergyLineCount', 'maintenanceLineCount',
          'futureUtilizationVerified', 'assetReadinessVerified', 'maintenanceScheduleVerified',
          'downtimeCostVerified', 'ownershipOrFinancingBasisVerified',
          'providerAuthenticated', 'reason']) ||
        [value.operations.futureUtilizationVerified, value.operations.assetReadinessVerified,
          value.operations.maintenanceScheduleVerified, value.operations.downtimeCostVerified,
          value.operations.ownershipOrFinancingBasisVerified,
          value.operations.providerAuthenticated].some(function (flag) { return flag !== false; }) ||
        !exact(value.learnedOutcomes, ['state', 'applicableServiceCount', 'applied', 'reason']) ||
        value.learnedOutcomes.applied !== false || value.completeOperatingCostForecastIssued !== false ||
        value.downtimeForecastIssued !== false || value.calibratedRangeIssued !== false ||
        value.probabilityIssued !== false || value.automaticActionAuthorized !== false) return null;
    if (value.state === 'unavailable') {
      if (REASONS.indexOf(value.reason) < 0 || value.currency !== null || value.forecastIssued !== false ||
          value.work.state !== 'unavailable' || value.work.scheduledCount !== null ||
          value.work.unscheduledCount !== null || value.work.outsideWindowCount !== null ||
          value.plannedEquipmentTravel.state !== 'unavailable' ||
          ['coveredCount', 'equipmentLineCount', 'tripCount', 'logisticsLineCount', 'equipmentCost',
            'grossTravelCost', 'overlapDeduction', 'netTravelCost', 'combinedCost'].some(function (key) {
            return value.plannedEquipmentTravel[key] !== null;
          }) || value.plannedEquipmentTravel.reason !== value.reason ||
          value.allocation.state !== 'unavailable' || value.allocation.v3AllocationReviewed !== false ||
          value.allocation.crossForecastLaborOverlapReviewed !== false ||
          value.allocation.reason !== value.reason || value.operations.state !== 'unavailable' ||
          value.operations.fuelOrEnergyLineCount !== null || value.operations.maintenanceLineCount !== null ||
          value.operations.reason !== value.reason || value.learnedOutcomes.state !== 'unavailable' ||
          value.learnedOutcomes.applicableServiceCount !== null ||
          value.learnedOutcomes.reason !== value.reason) return null;
      return value;
    }
    var plan = value.plannedEquipmentTravel;
    if (value.reason !== null || value.forecastIssued !== true || !/^[A-Z]{3}$/.test(value.currency || '') ||
        value.work.state !== 'current' ||
        ![value.work.scheduledCount, value.work.unscheduledCount,
          value.work.outsideWindowCount].every(function (item) { return count(item, 500); }) ||
        plan.state !== 'current' || !count(plan.coveredCount, 500) ||
        plan.coveredCount !== value.work.scheduledCount ||
        ![plan.equipmentLineCount, plan.tripCount, plan.logisticsLineCount].every(function (item) {
          return count(item);
        }) || ![plan.equipmentCost, plan.grossTravelCost, plan.overlapDeduction,
          plan.netTravelCost, plan.combinedCost].every(function (amount) { return MONEY.test(amount || ''); }) ||
        plan.reason !== null || value.allocation.state !== 'reviewed_v3_allocation' ||
        value.allocation.v3AllocationReviewed !== true ||
        value.allocation.crossForecastLaborOverlapReviewed !== true ||
        value.allocation.reason !== 'reviewed_allocation_applied' ||
        value.operations.state !== 'plan_cost_only' || !count(value.operations.fuelOrEnergyLineCount) ||
        !count(value.operations.maintenanceLineCount) ||
        value.operations.reason !== 'future_operations_evidence_unavailable' ||
        value.learnedOutcomes.state !== 'none_current' || value.learnedOutcomes.applicableServiceCount !== 0 ||
        value.learnedOutcomes.reason !== 'no_current_applicable_owner_adopted_multiplier') return null;
    return value;
  }
  function demoForecast() {
    return {
      version: 'm26-equipment-travel-cost-forecast-v1', state: 'current', reason: null,
      fictional: true, checkedAt: '2026-10-07T12:00:00.000Z', currency: 'USD',
      horizon: { startsAt: '2026-10-07T12:00:00.000Z', endsAt: '2026-11-06T12:00:00.000Z', days: 30 },
      scope: { label: 'Fictional next 30-day scheduled backlog',
        wholeBusinessCoverageVerified: false, offPlatformCoverageVerified: false },
      work: { state: 'current', scheduledCount: 3, unscheduledCount: 1, outsideWindowCount: 2 },
      plannedEquipmentTravel: { state: 'current', coveredCount: 3, equipmentLineCount: 4,
        tripCount: 5, logisticsLineCount: 3, equipmentCost: '2850.00',
        grossTravelCost: '1310.00', overlapDeduction: '180.00', netTravelCost: '1130.00',
        combinedCost: '3980.00', reason: null },
      allocation: { state: 'reviewed_v3_allocation', basis: 'owner_adopted_m24_cost_allocation_v3',
        v3AllocationReviewed: true, crossForecastLaborOverlapReviewed: true,
        reason: 'reviewed_allocation_applied' },
      operations: { state: 'plan_cost_only', fuelOrEnergyLineCount: 3, maintenanceLineCount: 2,
        futureUtilizationVerified: false, assetReadinessVerified: false,
        maintenanceScheduleVerified: false, downtimeCostVerified: false,
        ownershipOrFinancingBasisVerified: false,
        providerAuthenticated: false, reason: 'future_operations_evidence_unavailable' },
      learnedOutcomes: { state: 'none_current', applicableServiceCount: 0, applied: false,
        reason: 'no_current_applicable_owner_adopted_multiplier' },
      forecastIssued: true, completeOperatingCostForecastIssued: false,
      downtimeForecastIssued: false, calibratedRangeIssued: false,
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
      var message = 'Next 30-day planned equipment and travel cost: ' + value +
        (/[.!?]$/.test(value) ? ' ' : '. ') + context;
      var status = id('commandCenterEquipmentTravelForecastStatus');
      if (status.textContent !== message) status.textContent = message;
    }
    function loading() {
      var value = 'Checking adopted equipment, travel, and allocation plans.';
      var context = 'Waiting for current evidence.';
      id('commandCenterEquipmentTravelForecast').textContent = value;
      id('commandCenterEquipmentTravelForecastContext').textContent = '';
      announce(value, context);
    }
    function unavailable(value) {
      var result = 'Not available';
      var context = value && value.reason === 'learned_adjustment_compatibility_unverified' ?
        'A current learned equipment or travel adjustment exists, but this plan does not prove whether it already includes that adjustment.' :
        'The exact booked-work, adopted-plan, source, or reviewed-allocation evidence is incomplete.';
      id('commandCenterEquipmentTravelForecast').textContent = result;
      id('commandCenterEquipmentTravelForecastContext').textContent = context;
      announce(result, context);
    }
    function render(value) {
      var safe = validate(value);
      if (!safe || safe.state !== 'current') { unavailable(safe); return; }
      var plan = safe.plannedEquipmentTravel;
      var result = money(plan.combinedCost, safe.currency) + ' across ' + plan.coveredCount +
        (plan.coveredCount === 1 ? ' scheduled job' : ' scheduled jobs');
      var context = money(plan.equipmentCost, safe.currency) + ' planned equipment plus ' +
        money(plan.netTravelCost, safe.currency) + ' net travel after ' +
        money(plan.overlapDeduction, safe.currency) +
        ' of reviewed overlap. Owner-recorded plan costs only; future utilization, asset readiness, maintenance schedules, downtime, ownership or financing basis, provider truth, probability, and calibrated ranges are not verified.';
      id('commandCenterEquipmentTravelForecast').textContent = result;
      id('commandCenterEquipmentTravelForecastContext').textContent = context;
      announce(result, context);
    }
    function load() {
      var run = ++generation;
      loading();
      if (options.mode === 'demo') { render(demoForecast()); return Promise.resolve(); }
      return options.fetcher('/api/v1/forecast/equipment-travel-cost/current', {
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
  global.NorthStarEquipmentTravelCostForecast = {
    create: create, demoForecast: demoForecast, validate: validate,
  };
})(window);
