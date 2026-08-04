/** Legacy bridge retained as a read-only canonical presentation adapter. */
window.PolarisM13Bridge = (function () {
  'use strict';
  function augmentLead(lead) {
    if (!window.CanonicalIntelligence) return Promise.resolve(lead || null);
    return window.CanonicalIntelligence.loadCompatibility('customer-detail').then(function (projection) {
      var canonical = projection && projection.items && projection.items.length ? projection.items[0] : null;
      if (!lead || !canonical) return lead || null;
      return Object.freeze(Object.assign({}, lead, {
        polarisEstimate: canonical.values,
        canonical: canonical,
        readOnly: true,
      }));
    });
  }
  return Object.freeze({ augmentLead: augmentLead });
})();
