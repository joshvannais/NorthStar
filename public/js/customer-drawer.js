/**
 * CustomerDrawer — Shared Customer Record Drawer
 * The single customer detail view for the entire NorthStar platform.
 * Leads, Communications, and Dashboard all use this same component.
 *
 * Usage:
 *   CustomerDrawer.open(lead)  — populate and open the drawer
 *   CustomerDrawer.close()     — close the drawer
 *
 * Requires: drawer HTML template (drawer-overlay + customer-drawer) in the page,
 *           PolarisEngine, and the shared .tooltip and .drawer-* CSS from style.css.
 */
window.CustomerDrawer = (function() {
  var currentLead = null;

  function capitalizeFirst(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function fmtTime(dateVal) {
    if (!dateVal) return '\u2014';
    try {
      var d = new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch(e) { return String(dateVal); }
  }

  function getStatusBadge(status) {
    if (typeof StatusPill !== 'undefined' && StatusPill.renderDrawer) {
      return StatusPill.renderDrawer(status);
    }
    // Fallback if StatusPill not loaded
    var cls = 'badge-new';
    var label = 'New';
    if (status === 'contacted' || status === 'follow-up') { cls = 'badge-contacted'; label = 'Follow-up'; }
    else if (status === 'scheduled') { cls = 'badge-scheduled'; label = 'Appointment Set'; }
    else if (status === 'completed') { cls = 'badge-completed'; label = 'Completed'; }
    else if (status === 'won') { cls = 'badge-won'; label = 'Won'; }
    else if (status === 'lost') { cls = 'badge-lost'; label = 'Lost'; }
    else if (status === 'voicemail') { cls = 'badge-voicemail'; label = 'Voicemail'; }
    return '<span class="badge ' + cls + '">' + label + '</span>';
  }

  function generatePolarisIntel(lead) {
    var intel = {
      service: '',
      confidence: { score: 0, label: 'Pending', explanation: '' },
      pricing: { range: { low: 0, high: 0 }, breakdown: [], total: 0 },
      recommendedAction: '',
      evidence: [],
      assumptions: [],
      missing: [],
      scope: {}
    };

    intel.service = lead.service || lead.serviceRequested || '';

    // Try to extract canonical Polaris intelligence from estimate
    var canonical = null;
    if (lead.polarisEstimate) {
      if (lead.polarisEstimate.description) {
        try {
          canonical = typeof lead.polarisEstimate.description === 'string'
            ? JSON.parse(lead.polarisEstimate.description)
            : lead.polarisEstimate.description;
        } catch(e) { canonical = null; }
      }
      if (!canonical && lead.polarisEstimate.intel) {
        canonical = lead.polarisEstimate.intel;
      }
    }

    // PolarisEngine analysis as secondary source
    var analysis = lead.polarisAnalysis;
    if (!analysis && typeof PolarisEngine !== 'undefined' && PolarisEngine.analyzeLead) {
      try { analysis = PolarisEngine.analyzeLead(lead); } catch(e) {}
    }

    // Confidence — canonical first, then analysis, never hardcoded
    if (canonical && canonical.confidence) {
      intel.confidence = canonical.confidence;
    } else if (analysis) {
      var score = analysis.confidence || 0;
      intel.confidence = {
        score: score,
        label: score >= 80 ? 'High' : score >= 50 ? 'Medium' : 'Low',
        explanation: analysis.difficulty
          ? 'Based on ' + analysis.difficulty + ' complexity assessment.'
          : 'Based on available lead data.'
      };
    }

    // Recommended action — canonical first, then analysis
    if (canonical && canonical.recommendedAction) {
      intel.recommendedAction = canonical.recommendedAction;
    } else if (analysis && analysis.upsell) {
      intel.recommendedAction = analysis.upsell;
    }

    // Pricing — canonical breakdown from estimate items, then analysis
    if (lead.pricingBreakdown && Array.isArray(lead.pricingBreakdown) && lead.pricingBreakdown.length > 0) {
      intel.pricing.breakdown = [];
      var total = 0;
      for (var i = 0; i < lead.pricingBreakdown.length; i++) {
        var item = lead.pricingBreakdown[i];
        var amt = item.a || 0;
        if (amt > 0) { intel.pricing.breakdown.push(item); total += amt; }
      }
      intel.pricing.total = total;
      if (total > 0) {
        intel.pricing.range = { low: Math.round(total * 0.85), high: Math.round(total * 1.15) };
      }
    } else if (analysis && analysis.estimatedPrice && analysis.estimatedPrice > 0) {
      intel.pricing.total = analysis.estimatedPrice;
      intel.pricing.range = { low: Math.round(analysis.estimatedPrice * 0.85), high: Math.round(analysis.estimatedPrice * 1.15) };
    }

    // Scope, evidence, assumptions, missing — canonical first
    if (canonical) {
      intel.scope = canonical.scope || {};
      intel.evidence = canonical.evidence || [];
      intel.assumptions = canonical.assumptions || [];
      intel.missing = canonical.missing || [];
    } else if (analysis) {
      intel.assumptions = ['Estimated pricing based on market analysis and service category.'];
      if (lead.description) {
        intel.evidence = ['Customer inquiry: ' + (lead.description.length > 120 ? lead.description.substring(0, 120) + '...' : lead.description)];
      }
      intel.missing = ['On-site inspection needed for final pricing.'];
    }

    return intel;
  }

  function formatTranscript(transcript, callerName) {
    if (!transcript) return 'No transcript available.';
    try {
      return transcript.split('\n').map(function(l) {
        if (l.startsWith('AI:')) {
          return '<div class="transcript-line transcript-ai"><span class="transcript-speaker">AI</span> ' + l.substring(3) + '</div>';
        }
        if (l.startsWith('Customer:')) {
          var first = callerName ? callerName.split(' ')[0] : 'Customer';
          return '<div class="transcript-line transcript-customer"><span class="transcript-speaker">' + first + '</span> ' + l.substring(9) + '</div>';
        }
        return '<div class="transcript-line">' + l + '</div>';
      }).join('');
    } catch(e) { return transcript; }
  }

  function open(lead) {
    if (!lead) return;
    currentLead = lead;

    var el = function(id) { return document.getElementById(id); };

    el('drawerTitle').textContent = lead.caller || lead.customerName || 'Customer Details';

    // Contact Information
    el('drawerName').textContent = lead.caller || lead.customerName || '\u2014';
    el('drawerPhone').textContent = lead.phone || lead.phoneNumber || '\u2014';
    el('drawerAddress').textContent = lead.address || '\u2014';

    // Job Details
    el('drawerService').textContent = lead.service || lead.serviceRequested || '\u2014';
    var desc = lead.jobDetail || lead.summary || '';
    el('drawerDescription').textContent = desc ? capitalizeFirst(desc) : '\u2014';
    el('drawerValue').textContent = lead.avgPrice ? '$' + Math.round(lead.avgPrice).toLocaleString() : '\u2014';
    el('drawerStatus').innerHTML = getStatusBadge(lead.status || 'new');
    el('drawerDate').textContent = fmtTime(lead.time || (lead.receivedAt ? lead.receivedAt : null));

    // Check for existing customer profile
    if (typeof AppStore !== 'undefined' && AppStore.getCustomer) {
      var customer = AppStore.getCustomer(lead.id);
      if (customer) {
        showCustomerProfile(customer, lead);
      } else {
        var custSection = document.getElementById('drawerCustomerSection');
        var convSection = document.getElementById('drawerConvertSection');
        if (custSection) custSection.style.display = 'none';
        if (convSection) convSection.style.display = '';
      }
    }

    // ── Canonical Polaris Intelligence Card ──
    var intel = generatePolarisIntel(lead);
    var polarisEl = el('drawerPolarisInsight');

    // Confidence badge
    var confScore = intel.confidence.score || 0;
    var confLabel = intel.confidence.label || 'Pending';
    var confClass = confLabel.toLowerCase();
    var confExplanation = intel.confidence.explanation || '';

    // Pricing range
    var hasRange = intel.pricing.range.low > 0 && intel.pricing.range.high > 0;
    var hasBreakdown = intel.pricing.breakdown.length > 0;
    var rangeSection = '';
    if (hasRange) {
      rangeSection = '<div class="drawer-polaris-item">' +
        '<div class="drawer-polaris-item-label">Preliminary Range</div>' +
        '<div class="drawer-polaris-item-value" style="font-size:18px;font-weight:700;color:var(--brand-500);">' +
        '$' + Math.round(intel.pricing.range.low).toLocaleString() + ' \u2013 $' + Math.round(intel.pricing.range.high).toLocaleString() +
        '</div></div>';
    }

    // Pricing breakdown items
    var breakdownSection = '';
    if (hasBreakdown) {
      breakdownSection = '<div class="drawer-polaris-item">' +
        '<div class="drawer-polaris-item-label">Pricing Breakdown</div>' +
        '<div class="drawer-polaris-item-value">';
      var breakdownTotal = 0;
      for (var bi = 0; bi < intel.pricing.breakdown.length; bi++) {
        var bitem = intel.pricing.breakdown[bi];
        var amt = bitem.a || 0;
        breakdownTotal += amt;
        breakdownSection += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;">' +
          '<span>' + (bitem.l || 'Item') + '</span>' +
          '<span>$' + Math.round(amt).toLocaleString() + '</span></div>';
      }
      if (hasRange) {
        breakdownSection += '<div style="display:flex;justify-content:space-between;padding:4px 0;margin-top:4px;border-top:1px solid var(--neutral-200);font-size:12px;color:var(--neutral-500);">' +
          '<span>Cost subtotal</span><span>$' + Math.round(breakdownTotal).toLocaleString() + '</span></div>' +
          '<div style="font-size:10px;color:var(--neutral-400);margin-top:2px;">Range includes markup, contingency, and on-site verification</div>';
      } else {
        breakdownSection += '<div style="display:flex;justify-content:space-between;padding:4px 0;margin-top:4px;border-top:1px solid var(--neutral-200);font-size:12px;font-weight:600;">' +
          '<span>Total</span><span>$' + Math.round(breakdownTotal).toLocaleString() + '</span></div>';
      }
      breakdownSection += '</div></div>';
    }

    // Evidence
    var evidenceSection = '';
    if (intel.evidence.length > 0) {
      evidenceSection = '<div class="drawer-polaris-item">' +
        '<div class="drawer-polaris-item-label">Evidence</div><div class="drawer-polaris-item-value">';
      for (var ei = 0; ei < intel.evidence.length; ei++) {
        evidenceSection += '<div style="font-size:12px;padding:2px 0;">\u2022 ' + intel.evidence[ei] + '</div>';
      }
      evidenceSection += '</div></div>';
    }

    // Assumptions
    var assumptionsSection = '';
    if (intel.assumptions.length > 0) {
      assumptionsSection = '<div class="drawer-polaris-item">' +
        '<div class="drawer-polaris-item-label">Assumptions</div><div class="drawer-polaris-item-value">';
      for (var ai = 0; ai < intel.assumptions.length; ai++) {
        assumptionsSection += '<div style="font-size:12px;padding:2px 0;color:var(--neutral-500);">\u2022 ' + intel.assumptions[ai] + '</div>';
      }
      assumptionsSection += '</div></div>';
    }

    // Missing information
    var missingSection = '';
    if (intel.missing.length > 0) {
      missingSection = '<div class="drawer-polaris-item">' +
        '<div class="drawer-polaris-item-label">Missing Information</div><div class="drawer-polaris-item-value">';
      for (var mi = 0; mi < intel.missing.length; mi++) {
        missingSection += '<div style="font-size:12px;padding:2px 0;color:var(--warning);">\u26A0 ' + intel.missing[mi] + '</div>';
      }
      missingSection += '</div></div>';
    }

    // Scope dimensions
    var scopeSection = '';
    var scopeKeys = Object.keys(intel.scope);
    if (scopeKeys.length > 0) {
      scopeSection = '<div class="drawer-polaris-item">' +
        '<div class="drawer-polaris-item-label">Scope</div><div class="drawer-polaris-item-value">';
      for (var si = 0; si < scopeKeys.length; si++) {
        var k = scopeKeys[si];
        var v = intel.scope[k];
        if (v && typeof v === 'object') v = JSON.stringify(v);
        scopeSection += '<div style="font-size:12px;padding:2px 0;"><strong>' + k + ':</strong> ' + (v || '\u2014') + '</div>';
      }
      scopeSection += '</div></div>';
    }

    // Assemble the full Polaris card
    polarisEl.innerHTML =
      '<div class="drawer-polaris-grid">' +
        '<div class="drawer-polaris-item">' +
          '<div class="drawer-polaris-item-label">Service</div>' +
          '<div class="drawer-polaris-item-value" style="font-weight:600;">' + (intel.service || '\u2014') + '</div>' +
        '</div>' +
        rangeSection +
        breakdownSection +
        '<div class="drawer-polaris-item">' +
          '<div class="drawer-polaris-item-label">Confidence</div>' +
          '<div class="drawer-polaris-item-value">' +
            '<span class="polaris-confidence ' + confClass + '">' + confLabel +
              (confScore > 0 ? ' (' + confScore + '%)' : '') + '</span>' +
            (confExplanation ? '<div style="font-size:11px;color:var(--neutral-500);margin-top:3px;">' + confExplanation + '</div>' : '') +
          '</div>' +
        '</div>' +
        (intel.recommendedAction ?
          '<div class="drawer-polaris-item">' +
            '<div class="drawer-polaris-item-label">Recommended Action</div>' +
            '<div class="drawer-polaris-item-value" style="font-weight:500;">' + intel.recommendedAction + '</div>' +
          '</div>' : '') +
        scopeSection +
        evidenceSection +
        assumptionsSection +
        missingSection +
      '</div>';

    // Backwards-compat: populate the legacy pricing breakdown section
    var pbDiv = el('drawerPricingBreakdown');
    if (pbDiv) {
      if (hasBreakdown) {
        var pbHtml = '';
        var pbTotal = 0;
        for (var pbi = 0; pbi < intel.pricing.breakdown.length; pbi++) {
          var pbItem = intel.pricing.breakdown[pbi];
          var pba = pbItem.a || 0;
          pbTotal += pba;
          pbHtml += '<div class="drawer-pricing-item"><span>' + (pbItem.l || 'Item') + '</span><span>$' + Math.round(pba).toLocaleString() + '</span></div>';
        }
        pbHtml += '<div class="drawer-pricing-item"><span><strong>Total</strong></span><span><strong>$' + Math.round(pbTotal).toLocaleString() + '</strong></span></div>';
        pbDiv.innerHTML = pbHtml;
      } else if (hasRange) {
        pbDiv.innerHTML = '<p style="font-size:13px;color:var(--neutral-500);">Preliminary range: $' + Math.round(intel.pricing.range.low).toLocaleString() + ' \u2013 $' + Math.round(intel.pricing.range.high).toLocaleString() + '</p>';
      } else {
        pbDiv.innerHTML = '<p style="font-size:13px;color:var(--neutral-500);">Pricing will be available after Polaris processes this lead.</p>';
      }
    }

    // Call Transcript
    var transcriptEl = el('drawerTranscript');
    transcriptEl.innerHTML = formatTranscript(lead.transcript, lead.caller || lead.customerName);
    transcriptEl.scrollTop = 0;

    // Call Lifecycle Timeline (from liveTimeline via API)
    fetchTimeline(lead);

    // Open the drawer
    el('drawerOverlay').classList.add('open');
    el('customerDrawer').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function renderDrawerEstimate(estimate) {
    var panelEl = document.getElementById('drawerEstimatePanel');
    if (!panelEl) return;
    if (!estimate || !estimate.items) {
      panelEl.innerHTML = '<p style="font-size:13px;color:var(--neutral-500);">Add more lead details for a detailed estimate.</p>';
      return;
    }
    var itemRows = estimate.items.map(function(item) {
      var tl = item.type.charAt(0).toUpperCase() + item.type.slice(1);
      return '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--neutral-100);font-size:12px;"><span>' + tl + '</span><span>$' + item.amount.toFixed(2) + '</span></div>';
    }).join('');
    var totalRow = '<div style="display:flex;justify-content:space-between;padding:6px 0;margin-top:4px;border-top:2px solid var(--neutral-300);font-size:15px;font-weight:700;"><span>Total</span><span style="color:var(--brand-600);">$' + estimate.total.toFixed(2) + '</span></div>';
    var confClass = (estimate.confidenceLabel || 'low').toLowerCase();
    var badgeStyle = confClass === 'high' ? 'background:#dcfce7;color:#166534;' : confClass === 'medium' ? 'background:#fef3c7;color:#92400e;' : 'background:#fee2e2;color:#991b1b;';
    panelEl.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span style="font-size:13px;font-weight:500;">' + estimate.service + '</span><span style="font-size:10px;padding:1px 6px;border-radius:3px;' + badgeStyle + '">' + estimate.confidenceLabel + ' ' + estimate.confidence + '%</span></div>' + itemRows + totalRow;
    panelEl.parentElement.style.display = '';
  }

  function close() {
    var overlay = document.getElementById('drawerOverlay');
    var drawer = document.getElementById('customerDrawer');
    if (overlay) overlay.classList.remove('open');
    if (drawer) drawer.classList.remove('open');
    document.body.style.overflow = '';
    currentLead = null;
  }

  function convertToCustomer() {
    var lead = currentLead;
    if (!lead) return;
    if (typeof AppStore !== 'undefined' && AppStore.convertLeadToCustomer) {
      AppStore.convertLeadToCustomer(lead);
      var customer = AppStore.getCustomer(lead.id);
      if (customer) showCustomerProfile(customer, lead);
    }
  }

  function showCustomerProfile(customer, lead) {
    var custSection = document.getElementById('drawerCustomerSection');
    var convSection = document.getElementById('drawerConvertSection');
    if (!custSection || !convSection) return;
    custSection.style.display = '';
    convSection.style.display = 'none';
    var statusEl = document.getElementById('drawerCustomerStatus');
    var jobsEl = document.getElementById('drawerCustomerJobs');
    var revenueEl = document.getElementById('drawerCustomerRevenue');
    var notesEl = document.getElementById('drawerCustomerNotes');
    if (statusEl) statusEl.innerHTML = '<span class="badge badge-won">' + (customer.status || 'active') + '</span>';
    if (jobsEl) jobsEl.textContent = customer.totalJobs || 0;
    if (revenueEl) revenueEl.textContent = '$' + ((customer.totalRevenue || 0)).toLocaleString();
    if (notesEl) notesEl.textContent = customer.notes || 'No notes yet.';
  }

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') close();
  });

  /**
   * Fetch call lifecycle timeline for a lead that has a demoSessionId.
   * Appends a timeline section to the drawer body after successful fetch.
   */
  function fetchTimeline(lead) {
    var sessionId = lead.demoSessionId;
    if (!sessionId) {
      // No demo session — clear any stale timeline section
      var oldTimeline = document.getElementById('drawerTimelineSection');
      if (oldTimeline) oldTimeline.style.display = 'none';
      return;
    }

    var url = '/api/demo/' + encodeURIComponent(sessionId) + '/timeline';
    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.success || !data.entries || data.entries.length === 0) {
          var oldTimeline = document.getElementById('drawerTimelineSection');
          if (oldTimeline) oldTimeline.style.display = 'none';
          return;
        }
        renderTimeline(data.entries);
      })
      .catch(function() {
        var oldTimeline = document.getElementById('drawerTimelineSection');
        if (oldTimeline) oldTimeline.style.display = 'none';
      });
  }

  function renderTimeline(entries) {
    // Find or create the timeline section in the drawer body
    var section = document.getElementById('drawerTimelineSection');
    if (!section) {
      var body = document.getElementById('drawerBody');
      if (!body) return;
      section = document.createElement('div');
      section.className = 'drawer-section';
      section.id = 'drawerTimelineSection';
      body.appendChild(section);
    }
    section.style.display = '';

    var eventLabels = {
      'call_creating': '\uD83D\uDCDE Creating call...',
      'call_created': '\uD83D\uDCDE Call created',
      'call_started': '\uD83D\uDCDE Call started',
      'simulation_started': '\uD83D\uDD2C Simulation started',
      'conversation_started': '\uD83D\uDCAC Conversation started',
      'state_dialing': '\uD83D\uDCDE Dialing',
      'state_ringing': '\uD83D\uDD14 Ringing',
      'state_answered': '\u2705 Answered',
      'state_media_connected': '\uD83D\uDD0A Media connected',
      'state_live': '\uD83C\uDF99\uFE0F Live conversation',
      'state_completed': '\uD83C\uDFC1 Call completed',
      'state_polaris_summary': '\u2B50 Polaris summary generated',
      'call_completed': '\uD83C\uDFC1 Call completed',
    };

    var html = '<h3>\uD83D\uDCCB Call Lifecycle Timeline</h3>';
    html += '<div style="max-height:300px;overflow-y:auto;">';
    entries.forEach(function(entry) {
      var time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      var label = eventLabels[entry.event] || entry.event;
      var dotColor = entry.event === 'call_completed' || entry.event === 'state_completed' ? 'var(--success)' :
                     entry.event === 'state_polaris_summary' ? 'var(--brand-600)' :
                     entry.event && entry.event.indexOf('fail') >= 0 ? 'var(--danger)' : 'var(--brand-500)';
      html += '<div style="display:flex;gap:8px;padding:4px 0;font-size:13px;border-bottom:1px solid var(--neutral-100);">' +
        '<span style="color:var(--neutral-400);font-size:11px;white-space:nowrap;min-width:70px;">' + time + '</span>' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + dotColor + ';margin-top:4px;flex-shrink:0;"></span>' +
        '<span>' + label + '</span>' +
        '</div>';
    });
    html += '</div>';
    section.innerHTML = html;
  }

  return {
    open: open,
    close: close,
    convertToCustomer: convertToCustomer
  };
})();
