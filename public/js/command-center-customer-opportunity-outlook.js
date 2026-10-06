(function (global) {
  'use strict';

  var INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
  var ACTIONS = { estimate_review: 'Review estimate requests', lead_review: 'Review open leads',
    customer_review: 'Review customers' };
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
  function count(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 500; }
  function validate(value) {
    var top = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'scope', 'customers',
      'opportunities', 'qualification', 'estimateRequests', 'recommendedAction',
      'probabilityCalibrated', 'forecastIssued', 'automaticActionAuthorized'];
    if (!exact(value, top) || value.version !== 'm26-customer-opportunity-outlook-v1' ||
        !['current', 'unavailable'].includes(value.state) || typeof value.fictional !== 'boolean' ||
        !instant(value.checkedAt) ||
        !exact(value.scope, ['label', 'wholeBusinessCoverageVerified', 'providerCoverageVerified',
          'offPlatformCoverageVerified']) || value.scope.wholeBusinessCoverageVerified !== false ||
        value.scope.providerCoverageVerified !== false || value.scope.offPlatformCoverageVerified !== false ||
        !exact(value.customers, ['count', 'returningCount']) ||
        !exact(value.opportunities, ['count', 'reviewedCount', 'unreviewedCount']) ||
        !exact(value.qualification, ['open', 'qualified', 'unqualified', 'closed']) ||
        !exact(value.estimateRequests, ['open', 'requested', 'withdrawn', 'closed',
          'unreviewed', 'qualifiedNeedsReview']) ||
        !exact(value.recommendedAction, ['key', 'label', 'href']) ||
        !Object.prototype.hasOwnProperty.call(ACTIONS, value.recommendedAction.key) ||
        value.recommendedAction.label !== ACTIONS[value.recommendedAction.key] ||
        value.recommendedAction.href !== '/dashboard/leads' || value.probabilityCalibrated !== false ||
        value.forecastIssued !== false || value.automaticActionAuthorized !== false) return null;
    if (value.state === 'unavailable') {
      return value.reason === 'current_source_limit_exceeded' && value.fictional === false &&
        value.scope.label === 'Current NorthStar-recorded customer and reviewed opportunity records' &&
        Object.values(value.customers).every(function (item) { return item === null; }) &&
        Object.values(value.opportunities).every(function (item) { return item === null; }) &&
        Object.values(value.qualification).every(function (item) { return item === null; }) &&
        Object.values(value.estimateRequests).every(function (item) { return item === null; }) ? value : null;
    }
    if (value.reason !== null || value.scope.label !== (value.fictional ?
        'Fictional demo customer and reviewed opportunity records' :
        'Current NorthStar-recorded customer and reviewed opportunity records')) return null;
    var values = Object.values(value.customers).concat(Object.values(value.opportunities),
      Object.values(value.qualification), Object.values(value.estimateRequests));
    if (!values.every(count) || value.customers.returningCount > value.customers.count ||
        value.opportunities.reviewedCount + value.opportunities.unreviewedCount !==
          value.opportunities.count ||
        Object.values(value.qualification).reduce(function (sum, item) { return sum + item; }, 0) !==
          value.opportunities.reviewedCount ||
        value.estimateRequests.open + value.estimateRequests.requested +
          value.estimateRequests.withdrawn + value.estimateRequests.closed +
          value.estimateRequests.unreviewed !== value.opportunities.count ||
        value.estimateRequests.qualifiedNeedsReview > value.qualification.qualified) return null;
    var expected = value.estimateRequests.qualifiedNeedsReview > 0 ? 'estimate_review' :
      value.qualification.open > 0 || value.opportunities.unreviewedCount > 0 ? 'lead_review' :
        'customer_review';
    return value.recommendedAction.key === expected ? value : null;
  }
  function demoOutlook() {
    return {
      version: 'm26-customer-opportunity-outlook-v1', state: 'current', reason: null,
      fictional: true, checkedAt: '2026-10-06T12:00:00.000Z',
      scope: { label: 'Fictional demo customer and reviewed opportunity records',
        wholeBusinessCoverageVerified: false, providerCoverageVerified: false,
        offPlatformCoverageVerified: false },
      customers: { count: 12, returningCount: 3 },
      opportunities: { count: 8, reviewedCount: 7, unreviewedCount: 1 },
      qualification: { open: 2, qualified: 4, unqualified: 1, closed: 0 },
      estimateRequests: { open: 3, requested: 3, withdrawn: 0, closed: 1,
        unreviewed: 1, qualifiedNeedsReview: 2 },
      recommendedAction: { key: 'estimate_review', label: 'Review estimate requests',
        href: '/dashboard/leads' },
      probabilityCalibrated: false, forecastIssued: false, automaticActionAuthorized: false,
    };
  }
  function create(options) {
    var document = options.document; var mode = options.mode; var fetcher = options.fetcher; var generation = 0;
    function id(name) { return document.getElementById(name); }
    function checked(value) {
      var date = new Date(value);
      return Number.isFinite(date.getTime()) ? 'Last checked ' + date.toLocaleString([], {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      }) : 'Last checked time unavailable';
    }
    function fact(name, value) { id(name).textContent = value; }
    function loading() {
      id('commandCenterCustomerOpportunityOutlook').setAttribute('aria-busy', 'true');
      id('commandCenterCustomerOpportunityState').textContent = 'Loading';
      id('commandCenterCustomerOpportunityState').dataset.state = 'loading';
      id('commandCenterCustomerOpportunityAnswer').textContent =
        'Checking current customers and human-reviewed opportunity states.';
      id('commandCenterCustomerOpportunityScope').textContent = 'Checking current scope';
      id('commandCenterCustomerOpportunityCheckedAt').textContent = 'Checking now';
      ['Customers', 'Returning', 'Reviewed', 'LeadReview', 'EstimateReview', 'Requested']
        .forEach(function (name) { fact('commandCenterCustomerOpportunity' + name, ''); });
      id('commandCenterCustomerOpportunityDetailsBody').textContent = '';
      id('commandCenterCustomerOpportunityDetails').open = false;
    }
    function unavailable() {
      id('commandCenterCustomerOpportunityOutlook').setAttribute('aria-busy', 'false');
      id('commandCenterCustomerOpportunityState').textContent = 'Unavailable';
      id('commandCenterCustomerOpportunityState').dataset.state = 'unavailable';
      id('commandCenterCustomerOpportunityAnswer').textContent =
        'Current customer and opportunity records could not be verified. Refresh Command Center to try again.';
      id('commandCenterCustomerOpportunityScope').textContent =
        'Current NorthStar-recorded customer and reviewed opportunity records';
      id('commandCenterCustomerOpportunityCheckedAt').textContent = 'Last checked time unavailable';
      ['Customers', 'Returning', 'Reviewed', 'LeadReview', 'EstimateReview', 'Requested']
        .forEach(function (name) { fact('commandCenterCustomerOpportunity' + name, 'Not available'); });
      id('commandCenterCustomerOpportunityDetailsBody').textContent =
        'No customer identities, private notes, source identifiers, or unsupported conversion predictions are shown.';
    }
    function render(value) {
      var safe = validate(value);
      if (!safe || safe.state !== 'current') { unavailable(); return; }
      id('commandCenterCustomerOpportunityOutlook').setAttribute('aria-busy', 'false');
      id('commandCenterCustomerOpportunityState').textContent = safe.fictional ? 'Demo example' : 'Current';
      id('commandCenterCustomerOpportunityState').dataset.state = 'current';
      id('commandCenterCustomerOpportunityScope').textContent = safe.scope.label;
      id('commandCenterCustomerOpportunityCheckedAt').textContent = checked(safe.checkedAt);
      if (safe.estimateRequests.qualifiedNeedsReview > 0) {
        id('commandCenterCustomerOpportunityAnswer').textContent =
          safe.estimateRequests.qualifiedNeedsReview + ' qualified ' +
          (safe.estimateRequests.qualifiedNeedsReview === 1 ? 'opportunity needs' : 'opportunities need') +
          ' an estimate review.';
      } else if (safe.qualification.open + safe.opportunities.unreviewedCount > 0) {
        var total = safe.qualification.open + safe.opportunities.unreviewedCount;
        id('commandCenterCustomerOpportunityAnswer').textContent = total + ' current ' +
          (total === 1 ? 'opportunity needs' : 'opportunities need') + ' a lead review.';
      } else if (safe.opportunities.count === 0) {
        id('commandCenterCustomerOpportunityAnswer').textContent =
          'No current NorthStar-recorded opportunities need review.';
      } else {
        id('commandCenterCustomerOpportunityAnswer').textContent =
          'Every current opportunity has a human-reviewed qualification state.';
      }
      id('commandCenterCustomerOpportunityAction').textContent = safe.recommendedAction.label;
      id('commandCenterCustomerOpportunityAction').setAttribute('href', safe.recommendedAction.href);
      fact('commandCenterCustomerOpportunityCustomers', String(safe.customers.count));
      fact('commandCenterCustomerOpportunityReturning', String(safe.customers.returningCount));
      fact('commandCenterCustomerOpportunityReviewed', safe.opportunities.reviewedCount + ' of ' +
        safe.opportunities.count);
      fact('commandCenterCustomerOpportunityLeadReview', String(
        safe.qualification.open + safe.opportunities.unreviewedCount));
      fact('commandCenterCustomerOpportunityEstimateReview', String(
        safe.estimateRequests.qualifiedNeedsReview));
      fact('commandCenterCustomerOpportunityRequested', String(safe.estimateRequests.requested));
      id('commandCenterCustomerOpportunityDetailsBody').textContent =
        'These are current NorthStar records only. NorthStar does not predict who will book or contact customers, change prices, schedule work, or change a lead state from this insight.';
    }
    function load() {
      var run = ++generation; loading();
      if (mode === 'demo') { render(demoOutlook()); return Promise.resolve(); }
      return fetcher('/api/v1/forecast/customer-opportunity-outlook/current', {
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
  global.NorthStarCustomerOpportunityOutlook = {
    create: create, demoOutlook: demoOutlook, validate: validate,
  };
})(window);
