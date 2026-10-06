(function (global) {
  'use strict';

  var MONEY = /^(0|[1-9][0-9]{0,17})\.[0-9]{2}$/;
  var INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

  function exact(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === keys.length && keys.every(function (key) {
        return Object.prototype.hasOwnProperty.call(value, key);
      });
  }

  function instant(value) {
    if (typeof value !== 'string' || !INSTANT.test(value) || /T24:|:60(?:\.|Z)/.test(value)) return false;
    var parsed = new Date(value);
    var parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    return Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() === Number(parts[1]) &&
      parsed.getUTCMonth() + 1 === Number(parts[2]) && parsed.getUTCDate() === Number(parts[3]) &&
      parsed.getUTCHours() === Number(parts[4]) && parsed.getUTCMinutes() === Number(parts[5]) &&
      parsed.getUTCSeconds() === Number(parts[6]);
  }

  function validateMeasure(value, expectedState, aggregate) {
    if (!exact(value, ['state', 'amountBeforeTax']) || value.state !== expectedState) return false;
    return expectedState === 'current' ? (aggregate ? MONEY :
      /^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/).test(value.amountBeforeTax || '') :
      value.amountBeforeTax === null;
  }

  function validatePlanningFact(value, expectedState) {
    var valid = exact(value, ['state', 'count', 'amountBeforeTax', 'committed']) &&
      value.state === expectedState && value.committed === false &&
      (expectedState === 'current' ? Number.isSafeInteger(value.count) && value.count >= 0 &&
        value.count <= 256 && MONEY.test(value.amountBeforeTax || '') :
        value.count === null && value.amountBeforeTax === null);
    if (!valid || expectedState !== 'current') return valid;
    var parts = value.amountBeforeTax.split('.');
    var cents = BigInt(parts[0]) * 100n + BigInt(parts[1]);
    return cents <= BigInt(value.count) * 99999999999999n;
  }

  function validateOutlook(value) {
    var top = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'currency',
      'scope', 'authorizedEstimate', 'approvedPrice', 'bookedWork', 'planning',
      'earnedRevenue', 'cashTiming', 'forecastIssued', 'automaticActionAuthorized'];
    if (!exact(value, top) || value.version !== 'm26-revenue-cash-outlook-v1' ||
        !['current', 'unavailable'].includes(value.state) || typeof value.fictional !== 'boolean' ||
        !instant(value.checkedAt) || value.forecastIssued !== false ||
        value.automaticActionAuthorized !== false ||
        !exact(value.scope, ['label', 'wholeBusinessCoverageVerified']) ||
        !['Current supported NorthStar commercial records',
          'Fictional demo commercial records'].includes(value.scope.label) ||
        value.scope.wholeBusinessCoverageVerified !== false ||
        !exact(value.bookedWork, ['state', 'amountBeforeTax', 'classification']) ||
        value.bookedWork.classification !== 'committed' ||
        !exact(value.planning, ['state', 'reason', 'snapshotMode', 'capturedAt',
          'horizonStartsAt', 'horizonEndsAt', 'approvedNotBooked',
          'preliminaryEstimate', 'weightsWithheld', 'weightsAreScenarioAssumptions',
          'probability', 'forecastIssued']) ||
        !exact(value.planning.probability, ['state', 'reason']) ||
        value.planning.probability.state !== 'unavailable' ||
        value.planning.probability.reason !== 'calibrated_probability_authority_unavailable' ||
        value.planning.weightsWithheld !== true ||
        value.planning.weightsAreScenarioAssumptions !== true ||
        value.planning.forecastIssued !== false ||
        !exact(value.earnedRevenue, ['state', 'amount', 'reason']) ||
        value.earnedRevenue.state !== 'unavailable' || value.earnedRevenue.amount !== null ||
        value.earnedRevenue.reason !== 'recognition_authority_unavailable' ||
        !exact(value.cashTiming, ['state', 'amount', 'reason']) ||
        value.cashTiming.state !== 'unavailable' || value.cashTiming.amount !== null ||
        value.cashTiming.reason !== 'financial_period_coverage_unavailable') return null;
    var current = value.state === 'current';
    if (current ? value.reason !== null || !/^[A-Z]{3}$/.test(value.currency || '') ||
        !validateMeasure(value.authorizedEstimate, 'current', false) ||
        !validateMeasure(value.approvedPrice, 'current', false) ||
        !validateMeasure({ state: value.bookedWork.state,
          amountBeforeTax: value.bookedWork.amountBeforeTax }, 'current', false) :
      !['commercial_baseline_unavailable', 'commercial_baseline_not_current'].includes(value.reason) ||
        value.currency !== null || !validateMeasure(value.authorizedEstimate, 'unavailable', false) ||
        !validateMeasure(value.approvedPrice, 'unavailable', false) ||
        !validateMeasure({ state: value.bookedWork.state,
          amountBeforeTax: value.bookedWork.amountBeforeTax }, 'unavailable', false)) return null;
    var planningCurrent = value.planning.state === 'current';
    if (planningCurrent ? value.planning.reason !== null ||
        !['current_at_read', 'frozen_at_capture'].includes(value.planning.snapshotMode) ||
        !instant(value.planning.capturedAt) || !instant(value.planning.horizonStartsAt) ||
        !instant(value.planning.horizonEndsAt) ||
        Date.parse(value.planning.capturedAt) >= Date.parse(value.planning.horizonStartsAt) ||
        Date.parse(value.planning.horizonEndsAt) <= Date.parse(value.planning.horizonStartsAt) ||
        !validatePlanningFact(value.planning.approvedNotBooked, 'current') ||
        !validatePlanningFact(value.planning.preliminaryEstimate, 'current') ||
        value.planning.approvedNotBooked.count + value.planning.preliminaryEstimate.count > 256 :
      value.planning.state !== 'unavailable' ||
        value.planning.reason !== 'current_pipeline_snapshot_unavailable' ||
        value.planning.snapshotMode !== null || value.planning.capturedAt !== null ||
        value.planning.horizonStartsAt !== null || value.planning.horizonEndsAt !== null ||
        !validatePlanningFact(value.planning.approvedNotBooked, 'unavailable') ||
        !validatePlanningFact(value.planning.preliminaryEstimate, 'unavailable')) return null;
    if (!current && planningCurrent) return null;
    return value;
  }

  function demoOutlook() {
    return {
      version: 'm26-revenue-cash-outlook-v1', state: 'current', reason: null,
      fictional: true, checkedAt: '2026-10-06T12:00:00.000Z', currency: 'USD',
      scope: { label: 'Fictional demo commercial records', wholeBusinessCoverageVerified: false },
      authorizedEstimate: { state: 'current', amountBeforeTax: '18600.00' },
      approvedPrice: { state: 'current', amountBeforeTax: '12400.00' },
      bookedWork: { state: 'current', amountBeforeTax: '7200.00', classification: 'committed' },
      planning: {
        state: 'current', reason: null, snapshotMode: 'current_at_read',
        capturedAt: '2026-10-06T12:00:00.000Z',
        horizonStartsAt: '2026-11-01T00:00:00.000Z',
        horizonEndsAt: '2026-12-01T00:00:00.000Z',
        approvedNotBooked: { state: 'current', count: 2, amountBeforeTax: '5200.00', committed: false },
        preliminaryEstimate: { state: 'current', count: 3, amountBeforeTax: '6200.00', committed: false },
        weightsWithheld: true, weightsAreScenarioAssumptions: true,
        probability: { state: 'unavailable', reason: 'calibrated_probability_authority_unavailable' },
        forecastIssued: false,
      },
      earnedRevenue: { state: 'unavailable', amount: null, reason: 'recognition_authority_unavailable' },
      cashTiming: { state: 'unavailable', amount: null, reason: 'financial_period_coverage_unavailable' },
      forecastIssued: false, automaticActionAuthorized: false,
    };
  }

  function create(options) {
    var document = options.document;
    var mode = options.mode;
    var fetcher = options.fetcher;
    var generation = 0;
    function id(value) { return document.getElementById(value); }
    function money(value, currency) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency,
        minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(value));
    }
    function checked(value) {
      var date = new Date(value);
      return Number.isFinite(date.getTime()) ? 'Last checked ' + date.toLocaleString([], {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      }) : 'Last checked time unavailable';
    }
    function setFact(name, value) { id(name).textContent = value; }
    function unavailable() {
      var root = id('commandCenterRevenueCashOutlook');
      root.setAttribute('aria-busy', 'false');
      id('commandCenterRevenueCashState').textContent = 'Unavailable';
      id('commandCenterRevenueCashState').dataset.state = 'unavailable';
      id('commandCenterRevenueCashAnswer').textContent =
        'This outlook is unavailable because current commercial evidence could not be verified. Refresh Command Center to try again.';
      id('commandCenterRevenueCashScope').textContent = 'Current supported NorthStar records';
      id('commandCenterRevenueCashCheckedAt').textContent = 'Last checked time unavailable';
      ['commandCenterRevenueCashAuthorized', 'commandCenterRevenueCashApproved',
        'commandCenterRevenueCashBooked', 'commandCenterRevenueCashApprovedOpen',
        'commandCenterRevenueCashPreliminary', 'commandCenterRevenueCashEarned',
        'commandCenterRevenueCashCash'].forEach(function (name) { setFact(name, 'Not available'); });
      id('commandCenterRevenueCashBoundary').textContent =
        'Planning only. No revenue forecast or cash timing is shown while evidence is incomplete.';
      id('commandCenterRevenueCashDetailsBody').textContent =
        'No private scenario values, source identifiers, or accounting claims are shown.';
    }
    function loading() {
      id('commandCenterRevenueCashOutlook').setAttribute('aria-busy', 'true');
      id('commandCenterRevenueCashState').textContent = 'Loading';
      id('commandCenterRevenueCashState').dataset.state = 'loading';
      id('commandCenterRevenueCashAnswer').textContent = 'Checking the current supported commercial records.';
    }
    function render(value) {
      var safe = validateOutlook(value);
      if (!safe || safe.state !== 'current') { unavailable(); return; }
      id('commandCenterRevenueCashOutlook').setAttribute('aria-busy', 'false');
      id('commandCenterRevenueCashState').textContent = safe.fictional ? 'Fictional example' : 'Current';
      id('commandCenterRevenueCashState').dataset.state = 'current';
      var booked = money(safe.bookedWork.amountBeforeTax, safe.currency);
      var approved = money(safe.approvedPrice.amountBeforeTax, safe.currency);
      var authorized = money(safe.authorizedEstimate.amountBeforeTax, safe.currency);
      id('commandCenterRevenueCashAnswer').textContent = Number(safe.bookedWork.amountBeforeTax) === 0 ?
        'Current supported records contain no owner-confirmed booked work. Approved prices and authorized estimates are available in Review details.' :
        booked + ' is owner-confirmed booked work. Separate current stage totals show ' +
        approved + ' approved and ' + authorized + ' in authorized estimates.';
      id('commandCenterRevenueCashScope').textContent = safe.scope.label;
      id('commandCenterRevenueCashCheckedAt').textContent = checked(safe.checkedAt);
      setFact('commandCenterRevenueCashAuthorized', authorized);
      setFact('commandCenterRevenueCashApproved', approved);
      setFact('commandCenterRevenueCashBooked', booked + ' · committed');
      if (safe.planning.state === 'current') {
        setFact('commandCenterRevenueCashApprovedOpen',
          money(safe.planning.approvedNotBooked.amountBeforeTax, safe.currency) + ' · ' +
          safe.planning.approvedNotBooked.count + ' open');
        setFact('commandCenterRevenueCashPreliminary',
          money(safe.planning.preliminaryEstimate.amountBeforeTax, safe.currency) + ' · ' +
          safe.planning.preliminaryEstimate.count + ' open');
      } else {
        setFact('commandCenterRevenueCashApprovedOpen', 'Not available');
        setFact('commandCenterRevenueCashPreliminary', 'Not available');
      }
      setFact('commandCenterRevenueCashEarned', 'Not available · recognition authority required');
      setFact('commandCenterRevenueCashCash', 'Not available · complete period coverage required');
      id('commandCenterRevenueCashBoundary').textContent =
        'Planning only. Open pipeline is not committed; probability is not calibrated. Earned revenue and cash timing remain unavailable.';
      id('commandCenterRevenueCashDetailsBody').textContent =
        'Stage totals are separate and can overlap. Open-pipeline amounts are an unweighted ' +
        (safe.planning.snapshotMode === 'frozen_at_capture' ? 'frozen capture' : 'current snapshot') +
        ', not a probability or revenue forecast.';
    }
    function workspaceReady() {
      generation += 1;
      var request = generation;
      loading();
      if (mode === 'demo') {
        render(demoOutlook());
        return Promise.resolve(true);
      }
      return fetcher('/api/v1/forecast/revenue-cash-outlook/current', {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (payload) {
          if (request !== generation) return false;
          if (!response.ok || !payload || payload.success !== true) throw new Error('outlook unavailable');
          render(payload.data);
          return true;
        });
      }).catch(function () {
        if (request === generation) unavailable();
        return false;
      });
    }
    function workspaceUnavailable() { generation += 1; unavailable(); }
    unavailable();
    return Object.freeze({ workspaceReady: workspaceReady,
      workspaceUnavailable: workspaceUnavailable, render: render });
  }

  global.NorthStarRevenueCashOutlook = Object.freeze({
    create: create, validateOutlook: validateOutlook, demoOutlook: demoOutlook,
  });
})(window);
