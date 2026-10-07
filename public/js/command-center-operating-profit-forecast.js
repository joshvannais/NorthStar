(function (global) {
  'use strict';

  var MONEY = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
  var SIGNED = /^-?(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
  var MARGIN = /^-?(?:0|[1-9][0-9]{0,8})\.[0-9]{2}$/;
  var INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
  var REASONS = [
    'reporting_profile_unavailable', 'current_composition_coverage_unavailable',
    'dated_cash_source_unavailable', 'economic_expense_policy_unavailable',
    'economic_expense_policy_stale', 'approved_timing_attribution_unavailable',
    'compatible_revenue_unavailable', 'source_authenticated_composition_unavailable',
    'overhead_overlap_unavailable', 'nonzero_revenue_denominator_unavailable',
    'composition_cohort_mismatch',
  ];

  function exact(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === keys.length && keys.every(function (key) {
        return Object.prototype.hasOwnProperty.call(value, key);
      });
  }
  function instant(value) {
    return typeof value === 'string' && INSTANT.test(value) && Number.isFinite(Date.parse(value));
  }
  function scenario(value) {
    return exact(value, ['key', 'label', 'operatingCost', 'profit', 'margin', 'assumption']) &&
      /^[a-z][a-z0-9_-]{1,47}$/.test(value.key || '') &&
      typeof value.label === 'string' && value.label.length > 0 && value.label.length <= 80 &&
      MONEY.test(value.operatingCost || '') && SIGNED.test(value.profit || '') &&
      MARGIN.test(value.margin || '') &&
      exact(value.assumption, ['operatingCostBasisPoints', 'reason']) &&
      Number.isSafeInteger(value.assumption.operatingCostBasisPoints) &&
      value.assumption.operatingCostBasisPoints >= 5000 &&
      value.assumption.operatingCostBasisPoints <= 15999 &&
      typeof value.assumption.reason === 'string' && value.assumption.reason.length > 0;
  }
  function month(value) {
    return exact(value, ['month', 'revenue', 'directJobCost', 'incrementalJobOverhead',
      'fixedPeriodExpense', 'variablePeriodExpense', 'operatingCost', 'profitLow',
      'profitHigh', 'marginLow', 'marginHigh', 'scenarios']) &&
      /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.month || '') &&
      ['revenue', 'directJobCost', 'incrementalJobOverhead', 'fixedPeriodExpense',
        'variablePeriodExpense', 'operatingCost'].every(function (key) {
        return MONEY.test(value[key] || '');
      }) && SIGNED.test(value.profitLow || '') && SIGNED.test(value.profitHigh || '') &&
      MARGIN.test(value.marginLow || '') && MARGIN.test(value.marginHigh || '') &&
      Array.isArray(value.scenarios) && value.scenarios.length >= 2 &&
      value.scenarios.length <= 5 && value.scenarios.every(scenario);
  }
  function validate(value) {
    var keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'currency',
      'horizon', 'scope', 'kpis', 'months', 'revenue', 'costs', 'range', 'evidence',
      'run', 'forecastIssued', 'calibratedRangeIssued', 'probabilityIssued',
      'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-operating-profit-forecast-v1' ||
        ['current', 'unavailable'].indexOf(value.state) < 0 ||
        typeof value.fictional !== 'boolean' || !instant(value.checkedAt) ||
        !exact(value.horizon, ['kind', 'timeZone', 'startsAt', 'endsAt', 'startsOn',
          'endsOnExclusive']) ||
        value.horizon.kind !== 'next_30_elapsed_days_with_local_expense_dates' ||
        !instant(value.horizon.startsAt) || !instant(value.horizon.endsAt) ||
        Date.parse(value.horizon.endsAt) - Date.parse(value.horizon.startsAt) !== 2592000000 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.horizon.startsOn || '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.horizon.endsOnExclusive || '') ||
        Date.parse(value.horizon.endsOnExclusive + 'T00:00:00Z') -
          Date.parse(value.horizon.startsOn + 'T00:00:00Z') !== 2592000000 ||
        !exact(value.scope, ['label', 'wholeBusinessCoverageVerified',
          'offPlatformCoverageVerified']) ||
        value.scope.label !== 'Authenticated owner-confirmed scheduled backlog and recorded company operating expenses' ||
        value.scope.wholeBusinessCoverageVerified !== false ||
        value.scope.offPlatformCoverageVerified !== false ||
        !exact(value.kpis, ['operatingCost', 'profitLow', 'profitHigh', 'marginLow',
          'marginHigh']) ||
        !exact(value.revenue, ['target', 'amount', 'recognizedRevenueMeasured',
          'earnedRevenueMeasured', 'invoicedRevenueMeasured', 'collectedCashMeasured']) ||
        value.revenue.target !== 'approved_booked_price_before_tax' ||
        [value.revenue.recognizedRevenueMeasured, value.revenue.earnedRevenueMeasured,
          value.revenue.invoicedRevenueMeasured, value.revenue.collectedCashMeasured]
          .some(function (flag) { return flag !== false; }) ||
        !exact(value.costs, ['directJobCost', 'incrementalJobOverhead',
          'fixedPeriodExpense', 'variablePeriodExpense', 'operatingCost',
          'datedCashObligations', 'actualPaymentMeasured']) ||
        value.costs.actualPaymentMeasured !== false ||
        !exact(value.range, ['kind', 'scenarios', 'calibrated', 'probability']) ||
        value.range.kind !== 'deterministic_named_scenarios' ||
        value.range.calibrated !== false || value.range.probability !== false ||
        !exact(value.evidence, ['sourceAuthenticatedComposition',
          'componentQuantitiesAndCostsVerified', 'duplicatePreventionVerified',
          'approvedScheduleTiming', 'overlapReviewed', 'expenseCoverageVerified',
          'currentnessVerified', 'm25AdjustmentApplied', 'externalEventClassified',
          'scopeChangeClassified']) || value.evidence.m25AdjustmentApplied !== false ||
        value.evidence.externalEventClassified !== false ||
        value.evidence.scopeChangeClassified !== false ||
        !exact(value.run, ['calculationVersion', 'digest']) ||
        value.run.calculationVersion !== 'm26-operating-profit-calculation-v1' ||
        value.calibratedRangeIssued !== false || value.probabilityIssued !== false ||
        value.automaticActionAuthorized !== false || !Array.isArray(value.months) ||
        !Array.isArray(value.range.scenarios)) return null;
    if (value.state === 'unavailable') {
      return REASONS.indexOf(value.reason) >= 0 && value.currency === null &&
        value.forecastIssued === false && Object.keys(value.kpis).every(function (key) {
          return value.kpis[key] === null;
        }) && value.months.length === 0 && value.revenue.amount === null &&
        ['directJobCost', 'incrementalJobOverhead', 'fixedPeriodExpense',
          'variablePeriodExpense', 'operatingCost', 'datedCashObligations']
          .every(function (key) { return value.costs[key] === null; }) &&
        value.range.scenarios.length === 0 && Object.keys(value.evidence)
          .every(function (key) { return value.evidence[key] === false; }) &&
        value.run.digest === null ? value : null;
    }
    var orderedMonths = value.months.map(function (item) { return item.month; });
    if (value.reason !== null || value.forecastIssued !== true ||
        !/^[A-Z]{3}$/.test(value.currency || '') || !MONEY.test(value.kpis.operatingCost || '') ||
        !SIGNED.test(value.kpis.profitLow || '') || !SIGNED.test(value.kpis.profitHigh || '') ||
        !MARGIN.test(value.kpis.marginLow || '') || !MARGIN.test(value.kpis.marginHigh || '') ||
        value.months.length < 1 || value.months.length > 3 || !value.months.every(month) ||
        orderedMonths.join('|') !== orderedMonths.slice().sort().join('|') ||
        new Set(orderedMonths).size !== orderedMonths.length || !MONEY.test(value.revenue.amount || '') ||
        !['directJobCost', 'incrementalJobOverhead', 'fixedPeriodExpense',
          'variablePeriodExpense', 'operatingCost', 'datedCashObligations']
          .every(function (key) { return MONEY.test(value.costs[key] || ''); }) ||
        value.range.scenarios.length < 2 || value.range.scenarios.length > 5 ||
        !value.range.scenarios.every(scenario) ||
        ['sourceAuthenticatedComposition', 'componentQuantitiesAndCostsVerified',
          'duplicatePreventionVerified', 'approvedScheduleTiming', 'overlapReviewed',
          'expenseCoverageVerified', 'currentnessVerified'].some(function (key) {
          return value.evidence[key] !== true;
        }) || !/^[0-9a-f]{64}$/.test(value.run.digest || '')) return null;
    return value;
  }

  function demoForecast() {
    return {
      version: 'm26-operating-profit-forecast-v1', state: 'current', reason: null,
      fictional: true, checkedAt: '2026-10-07T12:00:00.000Z', currency: 'USD',
      horizon: { kind: 'next_30_elapsed_days_with_local_expense_dates',
        timeZone: 'America/New_York', startsAt: '2026-10-07T12:00:00.000Z',
        endsAt: '2026-11-06T12:00:00.000Z', startsOn: '2026-10-07',
        endsOnExclusive: '2026-11-06' },
      scope: { label: 'Authenticated owner-confirmed scheduled backlog and recorded company operating expenses',
        wholeBusinessCoverageVerified: false, offPlatformCoverageVerified: false },
      kpis: { operatingCost: '18000.00', profitLow: '4800.00', profitHigh: '7500.00',
        marginLow: '18.82', marginHigh: '29.41' },
      months: [
        { month: '2026-10', revenue: '15300.00', directJobCost: '7200.00',
          incrementalJobOverhead: '1080.00', fixedPeriodExpense: '2000.00',
          variablePeriodExpense: '600.00', operatingCost: '10880.00',
          profitLow: '2788.00', profitHigh: '4420.00', marginLow: '18.22', marginHigh: '28.89',
          scenarios: [
            { key: 'recorded_plan', label: 'Recorded plan', operatingCost: '10880.00',
              profit: '4420.00', margin: '28.89', assumption: {
                operatingCostBasisPoints: 10000, reason: 'Uses recorded economic costs.' } },
            { key: 'cost_pressure', label: 'Cost pressure', operatingCost: '12512.00',
              profit: '2788.00', margin: '18.22', assumption: {
                operatingCostBasisPoints: 11500, reason: 'Applies a named 15% cost assumption.' } },
          ] },
        { month: '2026-11', revenue: '10200.00', directJobCost: '4800.00',
          incrementalJobOverhead: '720.00', fixedPeriodExpense: '1200.00',
          variablePeriodExpense: '400.00', operatingCost: '7120.00',
          profitLow: '2012.00', profitHigh: '3080.00', marginLow: '19.73', marginHigh: '30.20',
          scenarios: [
            { key: 'recorded_plan', label: 'Recorded plan', operatingCost: '7120.00',
              profit: '3080.00', margin: '30.20', assumption: {
                operatingCostBasisPoints: 10000, reason: 'Uses recorded economic costs.' } },
            { key: 'cost_pressure', label: 'Cost pressure', operatingCost: '8188.00',
              profit: '2012.00', margin: '19.73', assumption: {
                operatingCostBasisPoints: 11500, reason: 'Applies a named 15% cost assumption.' } },
          ] },
      ],
      revenue: { target: 'approved_booked_price_before_tax', amount: '25500.00',
        recognizedRevenueMeasured: false, earnedRevenueMeasured: false,
        invoicedRevenueMeasured: false, collectedCashMeasured: false },
      costs: { directJobCost: '12000.00', incrementalJobOverhead: '1800.00',
        fixedPeriodExpense: '3200.00', variablePeriodExpense: '1000.00',
        operatingCost: '18000.00', datedCashObligations: '1150.00',
        actualPaymentMeasured: false },
      range: { kind: 'deterministic_named_scenarios', calibrated: false, probability: false,
        scenarios: [
          { key: 'recorded_plan', label: 'Recorded plan', operatingCost: '18000.00',
            profit: '7500.00', margin: '29.41', assumption: {
              operatingCostBasisPoints: 10000, reason: 'Uses recorded economic costs.' } },
          { key: 'cost_pressure', label: 'Cost pressure', operatingCost: '20700.00',
            profit: '4800.00', margin: '18.82', assumption: {
              operatingCostBasisPoints: 11500, reason: 'Applies a named 15% cost assumption.' } },
        ] },
      evidence: { sourceAuthenticatedComposition: true,
        componentQuantitiesAndCostsVerified: true, duplicatePreventionVerified: true,
        approvedScheduleTiming: true, overlapReviewed: true, expenseCoverageVerified: true,
        currentnessVerified: true, m25AdjustmentApplied: false,
        externalEventClassified: false, scopeChangeClassified: false },
      run: { calculationVersion: 'm26-operating-profit-calculation-v1',
        digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      forecastIssued: true, calibratedRangeIssued: false, probabilityIssued: false,
      automaticActionAuthorized: false,
    };
  }

  function create(options) {
    var document = options.document;
    var generation = 0;
    function id(name) { return document.getElementById(name); }
    function formatMoney(value, currency) {
      var negative = value.charAt(0) === '-';
      var pieces = (negative ? value.slice(1) : value).split('.');
      var formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency,
        minimumFractionDigits: 2, maximumFractionDigits: 2 }).formatToParts(BigInt(pieces[0]))
        .map(function (part) { return part.type === 'fraction' ? pieces[1] : part.value; }).join('');
      return negative ? '-' + formatted : formatted;
    }
    function clearValues() {
      ['commandCenterOperatingCostKpi', 'commandCenterOperatingProfitKpi',
        'commandCenterOperatingMarginKpi', 'commandCenterOperatingProfitRevenue',
        'commandCenterOperatingProfitDirect', 'commandCenterOperatingProfitJobOverhead',
        'commandCenterOperatingProfitPeriodExpense', 'commandCenterOperatingProfitCash']
        .forEach(function (name) { id(name).textContent = 'Not available'; });
      id('commandCenterOperatingProfitGraphPlot').textContent = '';
      id('commandCenterOperatingProfitGraphDescription').textContent =
        'No operating-profit values are shown.';
    }
    function announce(text) {
      if (id('commandCenterOperatingProfitStatus').textContent !== text) {
        id('commandCenterOperatingProfitStatus').textContent = text;
      }
    }
    function loading() {
      id('commandCenterOperatingProfit').setAttribute('aria-busy', 'true');
      id('commandCenterOperatingProfitState').textContent = 'Loading';
      id('commandCenterOperatingProfitState').dataset.state = 'loading';
      clearValues();
      id('commandCenterOperatingProfitExplanation').textContent =
        'Checking approved booked prices, adopted cost compositions, expense timing, and overlap review.';
      announce('Monthly operating outlook is loading. Previous values were cleared.');
    }
    function unavailable(value) {
      clearValues();
      var denominator = value && value.reason === 'nonzero_revenue_denominator_unavailable';
      var explanation = denominator ?
        'A known nonzero approved-price denominator is missing for one or more displayed months.' :
        'Current approved price, source composition, schedule timing, expense coverage, overlap review, or source authority is incomplete.';
      id('commandCenterOperatingProfit').setAttribute('aria-busy', 'false');
      id('commandCenterOperatingProfitState').textContent = 'Unavailable';
      id('commandCenterOperatingProfitState').dataset.state = 'unavailable';
      id('commandCenterOperatingProfitExplanation').textContent = explanation;
      announce('Monthly operating outlook is unavailable. ' + explanation);
    }
    function svg(name, attributes, text) {
      var node = document.createElementNS('http://www.w3.org/2000/svg', name);
      Object.keys(attributes || {}).forEach(function (key) { node.setAttribute(key, attributes[key]); });
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function renderGraph(value) {
      var plot = id('commandCenterOperatingProfitGraphPlot');
      plot.textContent = '';
      var figures = value.months.reduce(function (all, item) {
        return all.concat([Number(item.profitLow), Number(item.profitHigh)]);
      }, [0]);
      var minimum = Math.min.apply(Math, figures); var maximum = Math.max.apply(Math, figures);
      if (minimum === maximum) maximum = minimum + 1;
      var top = 20; var bottom = 135; var left = 76; var right = 610;
      function y(number) { return bottom - ((number - minimum) / (maximum - minimum)) * (bottom - top); }
      var zeroY = y(0);
      plot.appendChild(svg('line', { x1: left, y1: zeroY, x2: right, y2: zeroY,
        'class': 'command-center-operating-profit-zero' }));
      value.months.forEach(function (item, index) {
        var x = left + (index + 1) * ((right - left) / (value.months.length + 1));
        var lowY = y(Number(item.profitLow)); var highY = y(Number(item.profitHigh));
        plot.appendChild(svg('line', { x1: x, y1: lowY, x2: x, y2: highY,
          'class': 'command-center-operating-profit-range' }));
        plot.appendChild(svg('circle', { cx: x, cy: lowY, r: 5,
          'class': 'command-center-operating-profit-point' }));
        plot.appendChild(svg('circle', { cx: x, cy: highY, r: 5,
          'class': 'command-center-operating-profit-point' }));
        plot.appendChild(svg('text', { x: x, y: 160, 'text-anchor': 'middle' }, item.month));
      });
      id('commandCenterOperatingProfitGraphDescription').textContent = value.months.map(function (item) {
        return item.month + ': ' + formatMoney(item.profitLow, value.currency) + ' to ' +
          formatMoney(item.profitHigh, value.currency) + '.';
      }).join(' ');
    }
    function render(value) {
      var safe = validate(value);
      if (!safe || safe.state !== 'current') { unavailable(safe); return; }
      var profitRange = formatMoney(safe.kpis.profitLow, safe.currency) + '–' +
        formatMoney(safe.kpis.profitHigh, safe.currency);
      var marginRange = safe.kpis.marginLow + '%–' + safe.kpis.marginHigh + '%';
      id('commandCenterOperatingCostKpi').textContent = formatMoney(safe.kpis.operatingCost, safe.currency);
      id('commandCenterOperatingProfitKpi').textContent = profitRange;
      id('commandCenterOperatingMarginKpi').textContent = marginRange;
      id('commandCenterOperatingProfitRevenue').textContent = formatMoney(safe.revenue.amount, safe.currency);
      id('commandCenterOperatingProfitDirect').textContent = formatMoney(safe.costs.directJobCost, safe.currency);
      id('commandCenterOperatingProfitJobOverhead').textContent =
        formatMoney(safe.costs.incrementalJobOverhead, safe.currency);
      id('commandCenterOperatingProfitPeriodExpense').textContent =
        formatMoney(safe.costs.fixedPeriodExpense, safe.currency) + ' fixed + ' +
        formatMoney(safe.costs.variablePeriodExpense, safe.currency) + ' variable';
      id('commandCenterOperatingProfitCash').textContent =
        formatMoney(safe.costs.datedCashObligations, safe.currency) + ' kept outside profit';
      renderGraph(safe);
      var explanation = 'Across the next 30 days, approved booked price is ' +
        formatMoney(safe.revenue.amount, safe.currency) + '. Named cost assumptions put operating profit at ' +
        profitRange + ' and margin at ' + marginRange +
        '. Dated overhead and financing cash stay outside profit.';
      id('commandCenterOperatingProfitExplanation').textContent = explanation;
      id('commandCenterOperatingProfitState').textContent = safe.fictional ? 'Fictional example' : 'Current';
      id('commandCenterOperatingProfitState').dataset.state = 'current';
      id('commandCenterOperatingProfit').setAttribute('aria-busy', 'false');
      announce('Monthly operating outlook. Operating cost ' +
        formatMoney(safe.kpis.operatingCost, safe.currency) + '. Profit range ' + profitRange +
        '. Margin range ' + marginRange + '.');
    }
    function load() {
      var run = ++generation;
      loading();
      if (options.mode === 'demo') { render(demoForecast()); return Promise.resolve(); }
      return options.fetcher('/api/v1/forecast/operating-profit/current', {
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

  global.NorthStarOperatingProfitForecast = {
    create: create, demoForecast: demoForecast, validate: validate,
  };
})(window);
