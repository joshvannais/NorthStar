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
    if (!dateVal) return '—';
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

  function generatePolarisInsight(lead) {
    if (typeof PolarisEngine !== 'undefined' && PolarisEngine.analyzeLead) {
      var result = PolarisEngine.analyzeLead(lead);
      return result.insight || result;
    }
    return 'No Polaris insight available.';
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
    el('drawerName').textContent = lead.caller || lead.customerName || '—';
    el('drawerPhone').textContent = lead.phone || lead.phoneNumber || '—';
    el('drawerAddress').textContent = lead.address || '—';

    // Job Details
    el('drawerService').textContent = lead.service || lead.serviceRequested || '—';
    var desc = lead.jobDetail || lead.summary || '';
    el('drawerDescription').textContent = desc ? capitalizeFirst(desc) : '—';
    el('drawerValue').textContent = lead.avgPrice ? '$' + Math.round(lead.avgPrice).toLocaleString() : '—';
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

    // POLARIS Revenue Intelligence
    var polarisEl = el('drawerPolarisInsight');
    var analysis = lead.polarisAnalysis;
    if (!analysis && typeof PolarisEngine !== 'undefined' && PolarisEngine.analyzeLead) {
      analysis = PolarisEngine.analyzeLead(lead);
    }
    if (analysis && analysis.insight) {
      var confLabel = analysis.confidence >= 80 ? 'High' : analysis.confidence >= 50 ? 'Medium' : 'Low';
      var confClass = confLabel.toLowerCase();
      var price = Math.round(analysis.estimatedPrice || 0).toLocaleString();
      polarisEl.innerHTML = '<div class="drawer-polaris-grid">' +
        '<div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Summary</div><div class="drawer-polaris-item-value">' + analysis.insight + '</div></div>' +
        '<div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Pricing Recommendation</div><div class="drawer-polaris-item-value">$' + price + '</div></div>' +
        '<div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Confidence Score</div><div class="drawer-polaris-item-value"><span class="polaris-confidence ' + confClass + '">' + confLabel + ' (' + analysis.confidence + '%)</span></div></div>' +
        '<div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Revenue Opportunity</div><div class="drawer-polaris-item-value">$' + price + ' \u2014 ' + (analysis.service || 'Service') + '</div></div>' +
        '<div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Recommendation</div><div class="drawer-polaris-item-value">' + (analysis.upsell || 'Standard service') + '</div></div>' +
        '</div>';
    } else {
      polarisEl.innerHTML = '<p style="font-size:13px;color:var(--neutral-500);">' + generatePolarisInsight(lead) + '</p>';
    }

    // Generate Polaris estimate via M13 bridge
    if (typeof PolarisM13Bridge !== 'undefined' && PolarisM13Bridge.augmentLead && lead && lead.id) {
      if (!lead.polarisEstimate) {
        PolarisM13Bridge.augmentLead(lead).then(function() {
          if (lead.polarisEstimate) {
            renderDrawerEstimate(lead.polarisEstimate);
          }
        });
      } else {
        renderDrawerEstimate(lead.polarisEstimate);
      }
    } else if (typeof PolarisEngine !== 'undefined' && PolarisEngine.generateEstimate && lead && lead.id) {
      if (!lead.polarisEstimate) {
        try { PolarisEngine.generateEstimate(lead); } catch(e) {}
      }
      if (lead.polarisEstimate) {
        renderDrawerEstimate(lead.polarisEstimate);
      }
    }

    // Pricing Breakdown
    var pbDiv = el('drawerPricingBreakdown');
    if (lead.pricingBreakdown && Array.isArray(lead.pricingBreakdown) && lead.pricingBreakdown.length > 0) {
      var pbHtml = '';
      var pbTotal = 0;
      lead.pricingBreakdown.forEach(function(item) {
        pbTotal += item.a || 0;
        pbHtml += '<div class="drawer-pricing-item"><span>' + (item.l || 'Item') + '</span><span>$' + Math.round(item.a || 0).toLocaleString() + '</span></div>';
      });
      pbHtml += '<div class="drawer-pricing-item"><span><strong>Total</strong></span><span><strong>$' + Math.round(pbTotal).toLocaleString() + '</strong></span></div>';
      pbDiv.innerHTML = pbHtml;
    } else {
      pbDiv.innerHTML = '<p style="font-size:13px;color:var(--neutral-500);">Est. value: $' + Math.round(lead.avgPrice || 0).toLocaleString() + '</p>';
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
      'call_creating': '📞 Creating call...',
      'call_created': '📞 Call created',
      'call_started': '📞 Call started',
      'simulation_started': '🔬 Simulation started',
      'conversation_started': '💬 Conversation started',
      'state_dialing': '📞 Dialing',
      'state_ringing': '🔔 Ringing',
      'state_answered': '✅ Answered',
      'state_media_connected': '🔊 Media connected',
      'state_live': '🎙️ Live conversation',
      'state_completed': '🏁 Call completed',
      'state_polaris_summary': '⭐ Polaris summary generated',
      'call_completed': '🏁 Call completed',
    };

    var html = '<h3>📋 Call Lifecycle Timeline</h3>';
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