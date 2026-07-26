/** Legacy bridge retained as a read-only canonical presentation adapter. */
window.PolarisM13Bridge = (function () {
  'use strict';
  function augmentLead(lead) {
    if (!window.CanonicalIntelligence) return Promise.resolve(lead || null);
    return window.CanonicalIntelligence.loadCompatibility('customer-detail').then(function () {
      var estimate = window.PolarisEngine && window.PolarisEngine.generateEstimate ? window.PolarisEngine.generateEstimate(lead) : null;
      if (!lead || !estimate) return lead || null;
      return Object.freeze(Object.assign({}, lead, {
        polarisEstimate: estimate,
        canonical: estimate.canonicalValues,
        readOnly: true,
      }));
    });
  }
  return Object.freeze({ augmentLead: augmentLead });
})();
