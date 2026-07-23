/**
 * PolarisM13Bridge — Mission 13 Frontend Intelligence Bridge
 * Fetches customer and communications intelligence from M13 backend
 * and wires it into the existing PolarisEngine rendering.
 *
 * No UI changes. Augments existing data streams.
 */
window.PolarisM13Bridge = (function() {
  function scopedUrl(url) {
    return window.NorthStarDemoSession ? window.NorthStarDemoSession.appendToUrl(url) : url;
  }

  /**
   * Fetch customer intelligence data.
   * @param {string} customerId
   * @returns {Promise<object|null>}
   */
  function fetchCustomerIntelligence(customerId) {
    return new Promise(function(resolve) {
      if (!customerId) { resolve(null); return; }
      var xhr = new XMLHttpRequest();
      xhr.open('GET', scopedUrl('/api/v1/customers/' + encodeURIComponent(customerId) + '/health'), true);
      var token = localStorage.getItem('token');
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch(e) { resolve(null); }
        } else { resolve(null); }
      };
      xhr.onerror = function() { resolve(null); };
      xhr.send();
    });
  }

  /**
   * Fetch communications intelligence data.
   * @param {string} customerId
   * @returns {Promise<object|null>}
   */
  function fetchCommsIntelligence(customerId) {
    return new Promise(function(resolve) {
      if (!customerId) { resolve(null); return; }
      var xhr = new XMLHttpRequest();
      xhr.open('GET', scopedUrl('/api/v1/communications/intelligence/' + encodeURIComponent(customerId)), true);
      var token = localStorage.getItem('token');
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch(e) { resolve(null); }
        } else { resolve(null); }
      };
      xhr.onerror = function() { resolve(null); };
      xhr.send();
    });
  }

  /**
   * Fetch the full Polaris Intelligence Report (estimate + customer + comms).
   * @param {object} lead - Lead object from AppStore
   * @returns {Promise<object|null>}
   */
  function fetchFullIntelligence(lead) {
    return new Promise(function(resolve) {
      if (!lead) { resolve(null); return; }
      var body = {};
      for (var key in lead) {
        if (lead.hasOwnProperty(key) && typeof lead[key] !== 'function' && typeof lead[key] !== 'object') {
          body[key] = lead[key];
        }
      }
      // Include customerId from customer reference
      if (lead.customerId) body.customerId = lead.customerId;
      if (lead.id) body.id = lead.id;
      if (lead.jobId) body.jobId = lead.jobId;
      if (lead.crewId) body.crewId = lead.crewId;
      if (lead.opportunityId) body.opportunityId = lead.opportunityId;
      if (lead.assetIds && Array.isArray(lead.assetIds)) body.assetIds = lead.assetIds;

      var xhr = new XMLHttpRequest();
      xhr.open('POST', scopedUrl('/api/v1/polaris/intelligence'), true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      var token = localStorage.getItem('token');
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var estimate = JSON.parse(xhr.responseText);
            resolve(estimate);
            return;
          } catch(e) {}
        }
        resolve(null);
      };
      xhr.onerror = function() { resolve(null); };
      xhr.send(JSON.stringify(body));
    });
  }

  /**
   * Augment a lead object with M13 intelligence data.
   * Stores results into the lead object for existing UI to consume.
   * @param {object} lead - Lead object
   * @returns {Promise<object>} The augmented lead
   */
  function augmentLead(lead) {
    if (!lead) return Promise.resolve(lead);
    return fetchFullIntelligence(lead).then(function(estimate) {
      if (estimate) {
        // Store the enhanced estimate
        lead.polarisEstimate = estimate;

        // Build enhanced analysis from intelligence data
        var analysis = lead.polarisAnalysis || {};
        analysis.m13Intelligence = {};
        analysis.m13Intelligence.executiveSummary = estimate.executiveSummary || null;

        // Customer insights
        if (estimate.customerIntelligence) {
          analysis.m13Intelligence.customer = estimate.customerIntelligence;
          if (estimate.customerIntelligence.healthScore) {
            analysis.m13Insight = 'Customer health: ' + estimate.customerIntelligence.healthScore + '/100. ';
          }
        }

        // Communications insights
        if (estimate.communicationsIntelligence) {
          analysis.m13Intelligence.communications = estimate.communicationsIntelligence;
          if (estimate.communicationsIntelligence.lastContact) {
            analysis.m13Insight = (analysis.m13Insight || '') + 'Last contact: ' + estimate.communicationsIntelligence.lastContact + '. ';
          }
          if (estimate.communicationsIntelligence.pendingFollowUps && estimate.communicationsIntelligence.pendingFollowUps.length > 0) {
            analysis.m13Insight = (analysis.m13Insight || '') + estimate.communicationsIntelligence.pendingFollowUps.length + ' pending follow-up(s).';
          }
        }

        // Job intelligence
        if (estimate.jobIntelligence) {
          analysis.m13Intelligence.job = estimate.jobIntelligence;
          analysis.m13Insight = (analysis.m13Insight || '') + 'Job: ' + (estimate.jobIntelligence.status || 'unknown') + ' - ' + Math.round(estimate.jobIntelligence.progress || 0) + '% complete. ';
        }

        // Crew intelligence
        if (estimate.crewIntelligence) {
          analysis.m13Intelligence.crew = estimate.crewIntelligence;
          analysis.m13Insight = (analysis.m13Insight || '') + 'Crew: ' + (estimate.crewIntelligence.name || 'N/A') + '. ';
        }

        // Workflow intelligence
        if (estimate.workflowIntelligence) {
          analysis.m13Intelligence.workflow = estimate.workflowIntelligence;
          analysis.m13Insight = (analysis.m13Insight || '') + estimate.workflowIntelligence.totalTasks + ' tasks (' + estimate.workflowIntelligence.completionRate + '% complete). ';
        }

        // Asset intelligence
        if (estimate.assetsIntelligence) {
          analysis.m13Intelligence.assets = estimate.assetsIntelligence;
        }

        // Update confidence with data richness
        if (estimate.customerIntelligence && estimate.confidence < 85) {
          estimate.confidence = Math.min(88, estimate.confidence + 10);
          estimate.confidenceLabel = estimate.confidence >= 80 ? 'High' : estimate.confidence >= 50 ? 'Medium' : 'Low';
        }

        lead.polarisAnalysis = analysis;

        // Persist to AppStore if available
        if (window.AppStore && typeof window.AppStore.updateLead === 'function' && lead.id) {
          try {
            window.AppStore.updateLead(lead.id, {
              polarisEstimate: estimate,
              polarisAnalysis: analysis
            });
          } catch(e) {}
        }
      }
      return lead;
    });
  }

  return {
    fetchCustomerIntelligence: fetchCustomerIntelligence,
    fetchCommsIntelligence: fetchCommsIntelligence,
    fetchFullIntelligence: fetchFullIntelligence,
    augmentLead: augmentLead
  };
})();
