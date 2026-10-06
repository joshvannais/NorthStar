(function (global) {
  'use strict';

  var MONEY = /^-?(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
  var UNSIGNED = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
  var PERCENT = /^-?(?:0|[1-9][0-9]{0,14})\.[0-9]$/;
  var UNSIGNED_PERCENT = /^(?:0|[1-9][0-9]{0,14})\.[0-9]$/;
  var INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

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

  function cents(value) {
    var negative = value.charAt(0) === '-';
    var parts = (negative ? value.slice(1) : value).split('.');
    var amount = BigInt(parts[0]) * 100n + BigInt(parts[1]);
    return negative ? -amount : amount;
  }

  function ratioTenths(numerator, denominator) {
    if (denominator <= 0n) return null;
    var negative = numerator < 0n;
    var scaled = (negative ? -numerator : numerator) * 1000n;
    var rounded = scaled / denominator;
    if ((scaled % denominator) * 2n >= denominator) rounded += 1n;
    if (negative) rounded = -rounded;
    var absolute = rounded < 0n ? -rounded : rounded;
    return (rounded < 0n ? '-' : '') + (absolute / 10n).toString() + '.' +
      (absolute % 10n).toString();
  }

  function unavailableFacts(value) {
    return value.costBasis.state === 'unavailable' && value.costBasis.coveredCount === null &&
      value.costBasis.amount === null && value.costBasis.reason === 'current_cost_basis_unavailable' &&
      value.contribution.state === 'unavailable' && value.contribution.amount === null &&
      value.contribution.reason === 'current_cost_basis_unavailable' &&
      value.margin.state === 'unavailable' && value.margin.percent === null &&
      value.margin.reason === 'current_cost_basis_unavailable' &&
      value.concentration.state === 'unavailable' &&
      value.concentration.largestBookedSharePercent === null &&
      value.concentration.largestBookedAmount === null &&
      value.concentration.reason === 'current_booked_work_unavailable';
  }

  function validate(value) {
    var keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'currency', 'scope',
      'bookedWork', 'costBasis', 'contribution', 'margin', 'concentration', 'underutilization',
      'delays', 'equipmentDowntime', 'companyProfit', 'forecastIssued',
      'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-cost-risk-outlook-v1' ||
        !['current', 'unavailable'].includes(value.state) || typeof value.fictional !== 'boolean' ||
        !instant(value.checkedAt) || value.forecastIssued !== false ||
        value.automaticActionAuthorized !== false ||
        !exact(value.scope, ['label', 'wholeBusinessCoverageVerified']) ||
        value.scope.wholeBusinessCoverageVerified !== false ||
        !exact(value.bookedWork, ['state', 'count', 'amountBeforeTax']) ||
        !exact(value.costBasis, ['state', 'coveredCount', 'amount', 'reason']) ||
        !exact(value.contribution, ['state', 'amount', 'reason']) ||
        !exact(value.margin, ['state', 'percent', 'reason']) ||
        !exact(value.concentration,
          ['state', 'largestBookedSharePercent', 'largestBookedAmount', 'reason']) ||
        !exact(value.underutilization, ['state', 'location']) ||
        value.underutilization.state !== 'available_elsewhere' ||
        value.underutilization.location !== 'team_capacity' ||
        !exact(value.delays, ['state', 'reason']) || value.delays.state !== 'unavailable' ||
        value.delays.reason !== 'verified_delay_authority_unavailable' ||
        !exact(value.equipmentDowntime, ['state', 'reason']) ||
        value.equipmentDowntime.state !== 'unavailable' ||
        value.equipmentDowntime.reason !== 'verified_downtime_authority_unavailable' ||
        !exact(value.companyProfit, ['state', 'reason']) || value.companyProfit.state !== 'unavailable' ||
        value.companyProfit.reason !== 'complete_overhead_authority_unavailable') return null;
    if (value.state === 'unavailable') {
      return value.reason === 'commercial_sources_unavailable' && value.currency === null &&
        value.bookedWork.state === 'unavailable' && value.bookedWork.count === null &&
        value.bookedWork.amountBeforeTax === null && value.fictional === false &&
        value.scope.label === 'Current owner-confirmed booked work' && unavailableFacts(value) ? value : null;
    }
    if (value.reason !== null || !/^[A-Z]{3}$/.test(value.currency || '') ||
        value.scope.label !== (value.fictional ? 'Fictional demo booked work' :
          'Current owner-confirmed booked work') ||
        value.bookedWork.state !== 'current' || !Number.isSafeInteger(value.bookedWork.count) ||
        value.bookedWork.count < 0 || value.bookedWork.count > 1000 ||
        !UNSIGNED.test(value.bookedWork.amountBeforeTax || '') ||
        !Number.isSafeInteger(value.costBasis.coveredCount) || value.costBasis.coveredCount < 0 ||
        value.costBasis.coveredCount > value.bookedWork.count) return null;
    if (value.costBasis.state === 'current') {
      if (value.costBasis.reason !== null || value.costBasis.coveredCount !== value.bookedWork.count ||
          !UNSIGNED.test(value.costBasis.amount || '') || value.contribution.state !== 'current' ||
          value.contribution.reason !== null || !MONEY.test(value.contribution.amount || '') ||
          cents(value.contribution.amount) !== cents(value.bookedWork.amountBeforeTax) -
            cents(value.costBasis.amount)) return null;
      var bookedCents = cents(value.bookedWork.amountBeforeTax);
      var marginCurrent = value.margin.state === 'current';
      if (bookedCents > 0n ? !marginCurrent || value.margin.reason !== null ||
          !PERCENT.test(value.margin.percent || '') || value.margin.percent !==
            ratioTenths(cents(value.contribution.amount), bookedCents) :
        marginCurrent || value.margin.state !== 'unavailable' || value.margin.percent !== null ||
          value.margin.reason !== 'no_booked_value') return null;
    } else if (value.costBasis.state !== 'unavailable' || value.costBasis.amount !== null ||
        value.costBasis.reason !== 'incomplete_current_cost_basis' ||
        value.contribution.state !== 'unavailable' || value.contribution.amount !== null ||
        value.contribution.reason !== 'incomplete_current_cost_basis' ||
        value.margin.state !== 'unavailable' || value.margin.percent !== null ||
        value.margin.reason !== 'incomplete_current_cost_basis') return null;
    if (value.concentration.state === 'current') {
      var bookedValueCents = cents(value.bookedWork.amountBeforeTax);
      if (value.concentration.reason !== null || !UNSIGNED_PERCENT.test(
        value.concentration.largestBookedSharePercent || '') ||
        !UNSIGNED.test(value.concentration.largestBookedAmount || '') ||
        value.bookedWork.count < 1 || bookedValueCents <= 0n ||
        cents(value.concentration.largestBookedAmount) > bookedValueCents ||
        value.concentration.largestBookedSharePercent !== ratioTenths(
          cents(value.concentration.largestBookedAmount), bookedValueCents)) return null;
    } else if (value.concentration.state !== 'none' ||
        value.bookedWork.amountBeforeTax !== '0.00' || value.concentration.reason !== null ||
        value.concentration.largestBookedSharePercent !== '0.0' ||
        value.concentration.largestBookedAmount !== '0.00') return null;
    return value;
  }

  function demoOutlook() {
    return {
      version: 'm26-cost-risk-outlook-v1', state: 'current', reason: null,
      fictional: true, checkedAt: '2026-10-06T12:00:00.000Z', currency: 'USD',
      scope: { label: 'Fictional demo booked work', wholeBusinessCoverageVerified: false },
      bookedWork: { state: 'current', count: 3, amountBeforeTax: '18000.00' },
      costBasis: { state: 'current', coveredCount: 3, amount: '11400.00', reason: null },
      contribution: { state: 'current', amount: '6600.00', reason: null },
      margin: { state: 'current', percent: '36.7', reason: null },
      concentration: { state: 'current', largestBookedSharePercent: '44.4',
        largestBookedAmount: '8000.00', reason: null },
      underutilization: { state: 'available_elsewhere', location: 'team_capacity' },
      delays: { state: 'unavailable', reason: 'verified_delay_authority_unavailable' },
      equipmentDowntime: { state: 'unavailable', reason: 'verified_downtime_authority_unavailable' },
      companyProfit: { state: 'unavailable', reason: 'complete_overhead_authority_unavailable' },
      forecastIssued: false, automaticActionAuthorized: false,
    };
  }

  function create(options) {
    var document = options.document;
    var mode = options.mode;
    var fetcher = options.fetcher;
    var generation = 0;
    function id(name) { return document.getElementById(name); }
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
    function fact(name, value) { id(name).textContent = value; }
    function loading() {
      id('commandCenterCostRiskOutlook').setAttribute('aria-busy', 'true');
      id('commandCenterCostRiskState').textContent = 'Loading';
      id('commandCenterCostRiskState').dataset.state = 'loading';
      id('commandCenterCostRiskAnswer').textContent = 'Checking booked work and current cost plans.';
      id('commandCenterCostRiskScope').textContent = 'Checking current scope';
      id('commandCenterCostRiskCheckedAt').textContent = 'Checking now';
      ['Booked', 'Cost', 'Contribution', 'Margin', 'Concentration', 'CompanyProfit',
        'Downtime'].forEach(function (name) { fact('commandCenterCostRisk' + name, ''); });
      id('commandCenterCostRiskDetailsBody').textContent = '';
      id('commandCenterCostRiskDetails').open = false;
    }
    function unavailable() {
      id('commandCenterCostRiskOutlook').setAttribute('aria-busy', 'false');
      id('commandCenterCostRiskState').textContent = 'Unavailable';
      id('commandCenterCostRiskState').dataset.state = 'unavailable';
      id('commandCenterCostRiskAnswer').textContent =
        'Current booked-work cost evidence could not be verified. Refresh Command Center to try again.';
      id('commandCenterCostRiskScope').textContent = 'Current owner-confirmed booked work';
      id('commandCenterCostRiskCheckedAt').textContent = 'Last checked time unavailable';
      ['Booked', 'Cost', 'Contribution', 'Margin', 'Concentration', 'CompanyProfit',
        'Downtime'].forEach(function (name) { fact('commandCenterCostRisk' + name, 'Not available'); });
      id('commandCenterCostRiskDetailsBody').textContent =
        'No source identifiers, private pricing inputs, or unsupported risk predictions are shown.';
    }
    function render(value) {
      var safe = validate(value);
      if (!safe || safe.state !== 'current') { unavailable(); return; }
      id('commandCenterCostRiskOutlook').setAttribute('aria-busy', 'false');
      id('commandCenterCostRiskState').textContent = safe.fictional ? 'Demo example' : 'Current';
      id('commandCenterCostRiskState').dataset.state = 'current';
      id('commandCenterCostRiskScope').textContent = safe.scope.label;
      id('commandCenterCostRiskCheckedAt').textContent = checked(safe.checkedAt);
      if (safe.bookedWork.count === 0) {
        id('commandCenterCostRiskAnswer').textContent =
          'No owner-confirmed booked work is in this supported set.';
      } else if (safe.costBasis.state === 'current') {
        id('commandCenterCostRiskAnswer').textContent = money(safe.contribution.amount, safe.currency) +
          ' remains after current planned job costs' + (safe.margin.state === 'current' ?
            ' (' + safe.margin.percent + '% of booked value).' : '.');
      } else {
        id('commandCenterCostRiskAnswer').textContent = money(safe.bookedWork.amountBeforeTax, safe.currency) +
          ' is booked, but current cost plans cover ' + safe.costBasis.coveredCount + ' of ' +
          safe.bookedWork.count + ' jobs.';
      }
      fact('commandCenterCostRiskBooked', money(safe.bookedWork.amountBeforeTax, safe.currency) +
        ' across ' + safe.bookedWork.count + (safe.bookedWork.count === 1 ? ' job' : ' jobs'));
      fact('commandCenterCostRiskCost', safe.costBasis.state === 'current' ?
        money(safe.costBasis.amount, safe.currency) : safe.costBasis.coveredCount + ' of ' +
          safe.bookedWork.count + ' jobs covered');
      fact('commandCenterCostRiskContribution', safe.contribution.state === 'current' ?
        money(safe.contribution.amount, safe.currency) : 'Not available');
      fact('commandCenterCostRiskMargin', safe.margin.state === 'current' ?
        safe.margin.percent + '%' : 'Not available');
      fact('commandCenterCostRiskConcentration', safe.concentration.state === 'current' ?
        safe.concentration.largestBookedSharePercent + '% in the largest job (' +
          money(safe.concentration.largestBookedAmount, safe.currency) + ')' :
        safe.bookedWork.count === 0 ? 'No booked jobs' : 'Booked value is $0');
      fact('commandCenterCostRiskCompanyProfit', 'Not available — company overhead is incomplete');
      fact('commandCenterCostRiskDowntime', 'Not available — no verified delay or downtime source');
      id('commandCenterCostRiskDetailsBody').textContent =
        'Team underutilization stays in Team capacity. This insight does not predict failures, delays, stockouts, or equipment downtime.';
    }
    function load() {
      var run = ++generation;
      loading();
      if (mode === 'demo') { render(demoOutlook()); return Promise.resolve(); }
      return fetcher('/api/v1/forecast/cost-risk-outlook/current', {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
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

  global.NorthStarCostRiskOutlook = { create: create, demoOutlook: demoOutlook, validate: validate };
})(window);
