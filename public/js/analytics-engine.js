/** AnalyticsEngine - presentation-only selectors for server aggregates. */
window.AnalyticsEngine = (function () {
  'use strict';
  function metrics() {
    if (!window.CanonicalIntelligence) return null;
    var projection = window.CanonicalIntelligence.getProjection('command-center') ||
      window.CanonicalIntelligence.getProjection('executive') ||
      window.CanonicalIntelligence.getProjection('leads');
    return projection && projection.metrics ? projection.metrics : null;
  }
  function field(name, unavailable) {
    var current = metrics();
    return current && current[name] !== undefined ? current[name] : unavailable;
  }
  return Object.freeze({
    total: function () { return field('graphCount', null); },
    todayCalls: function () { return null; },
    scheduled: function () { return field('appointmentCount', null); },
    appointments: function () { return field('appointmentCount', null); },
    totalRevenue: function () { return field('estimatedRevenue', null); },
    avgJobValue: function () { return null; },
    pipelineValue: function () { return field('estimatedRevenue', null); },
    avgCallLength: function () { return null; },
    avgResponseTime: function () { return null; },
    conversionRate: function () { return '\u2014'; },
    conversionRateNumeric: function () { return null; },
    won: function () { return null; },
    qualified: function () { return null; },
    revenueTrends: function () { return []; },
    missedCalls: function () { return null; },
  });
})();
