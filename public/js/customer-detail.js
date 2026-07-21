/**
 * CustomerDetail — Universal Customer Record Drawer
 *
 * The single, shared customer detail component for the entire NorthStar platform.
 * Leads, Communications, and Command Center all use this same component.
 *
 * Usage:
 *   CustomerDetail.open(customerId)     — fetch all data, render drawer
 *   CustomerDetail.close()              — close drawer, return focus
 *   CustomerDetail.selectTranscript(id) — switch transcript view
 *
 * Injects its own drawer HTML into document.body on first open().
 * Uses canonical Polaris APIs and demo-msg transcript styling from index.html.
 */
window.CustomerDetail = (function() {
  var _currentData = null;
  var _overlayEl = null;
  var _drawerEl = null;
  var _injected = false;
  var _commIdToTranscript = {};

  // ── Helpers ──

  function $(id) { return document.getElementById(id); }

  function fmtCurrency(n) {
    if (n == null || isNaN(n)) return '$0';
    return '$' + Math.round(n).toLocaleString();
  }

  function fmtDate(val) {
    if (!val) return '\u2014';
    try {
      var d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return String(val); }
  }

  function capitalizeFirst(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function stageLabel(stage) {
    var map = {
      lead: 'Lead', qualified: 'Qualified', discovery: 'Discovery',
      proposal: 'Proposal', negotiation: 'Negotiation',
      verbalCommitment: 'Verbal Commitment', won: 'Won', lost: 'Lost', archived: 'Archived'
    };
    return map[stage] || capitalizeFirst(stage || 'Unknown');
  }

  function stageProb(stage) {
    var map = {
      lead: 5, qualified: 15, discovery: 30, proposal: 50,
      negotiation: 70, verbalCommitment: 85, won: 100, lost: 0, archived: 0
    };
    return map[stage] != null ? map[stage] : 0;
  }

  function getStatusBadge(status) {
    if (typeof StatusPill !== 'undefined' && StatusPill.renderDrawer) {
      return StatusPill.renderDrawer(status);
    }
    var cls = 'badge-new', label = 'New';
    if (status === 'contacted' || status === 'follow-up') { cls = 'badge-contacted'; label = 'Follow-up'; }
    else if (status === 'scheduled') { cls = 'badge-scheduled'; label = 'Appointment Set'; }
    else if (status === 'completed') { cls = 'badge-completed'; label = 'Completed'; }
    else if (status === 'won') { cls = 'badge-won'; label = 'Won'; }
    else if (status === 'lost') { cls = 'badge-lost'; label = 'Lost'; }
    else if (status === 'voicemail') { cls = 'badge-voicemail'; label = 'Voicemail'; }
    return '<span class="badge ' + cls + '">' + label + '</span>';
  }

  // ── Drawer Injection ──

  function injectDrawerHTML() {
    if (_injected) return;
    var html = '';
    html += '<div class="drawer-overlay" id="cdDrawerOverlay"></div>';
    html += '<div class="customer-drawer" id="cdCustomerDrawer">';
    html += '  <div class="drawer-header">';
    html += '    <h2 id="cdDrawerTitle">Customer Details</h2>';
    html += '    <button class="drawer-close-btn" id="cdDrawerClose">&times;</button>';
    html += '  </div>';
    html += '  <div class="drawer-body" id="cdDrawerBody">';
    // Loading state
    html += '    <div id="cdDrawerLoading" style="text-align:center;padding:40px 20px;">';
    html += '      <div style="width:32px;height:32px;border:3px solid var(--neutral-200);border-top-color:var(--brand-600);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px;"></div>';
    html += '      <p style="font-size:14px;color:var(--neutral-500);">Loading customer data\u2026</p>';
    html += '    </div>';
    // Content wrapper (hidden during load)
    html += '    <div id="cdDrawerContent" style="display:none;">';

    // Contact Information
    html += '      <div class="drawer-section">';
    html += '        <h3>Contact Information</h3>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Name</span><span class="drawer-detail-value" id="cdName">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Phone</span><span class="drawer-detail-value" id="cdPhone">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Email</span><span class="drawer-detail-value" id="cdEmail">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Address</span><span class="drawer-detail-value" id="cdAddress">\u2014</span></div>';
    html += '      </div>';

    // Customer Profile
    html += '      <div class="drawer-section" id="cdProfileSection">';
    html += '        <h3>Customer Profile</h3>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Status</span><span class="drawer-detail-value" id="cdProfileStatus">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Total Jobs</span><span class="drawer-detail-value" id="cdProfileJobs">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Total Revenue</span><span class="drawer-detail-value" id="cdProfileRevenue">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Last Interaction</span><span class="drawer-detail-value" id="cdProfileLastInteraction">\u2014</span></div>';
    html += '      </div>';

    // Job Details
    html += '      <div class="drawer-section">';
    html += '        <h3>Job Details</h3>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Service</span><span class="drawer-detail-value" id="cdService">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Description</span><span class="drawer-detail-value" id="cdDescription">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Estimated Value</span><span class="drawer-detail-value" id="cdEstValue">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Opportunity Stage</span><span class="drawer-detail-value" id="cdStage">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Close Probability</span><span class="drawer-detail-value" id="cdProb">\u2014</span></div>';
    html += '      </div>';

    // POLARIS\u2122 Intelligence
    html += '      <div class="drawer-section">';
    html += '        <h3>POLARIS\u2122 Intelligence</h3>';
    html += '        <div class="drawer-polaris-insight" id="cdPolarisInsight">';
    html += '          <div class="drawer-polaris-grid">';
    html += '            <div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Summary</div><div class="drawer-polaris-item-value" id="cdPolSummary">\u2014</div></div>';
    html += '            <div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Pricing Recommendation</div><div class="drawer-polaris-item-value" id="cdPolPrice">\u2014</div></div>';
    html += '            <div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Confidence</div><div class="drawer-polaris-item-value" id="cdPolConfidence">\u2014</div></div>';
    html += '            <div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Revenue Opportunity</div><div class="drawer-polaris-item-value" id="cdPolRevenue">\u2014</div></div>';
    html += '            <div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Recommended Action</div><div class="drawer-polaris-item-value" id="cdPolAction">\u2014</div></div>';
    html += '          </div>';
    html += '        </div>';
    html += '      </div>';

    // Pricing Breakdown
    html += '      <div class="drawer-section">';
    html += '        <h3>Pricing Breakdown</h3>';
    html += '        <div id="cdPricingBreakdown"><p style="font-size:13px;color:var(--neutral-500);">No estimate data available.</p></div>';
    html += '      </div>';

    // Call Transcript
    html += '      <div class="drawer-section">';
    html += '        <h3>Call Transcript</h3>';
    html += '        <div class="drawer-transcript" id="cdTranscript" style="display:flex;flex-direction:column;gap:10px;overflow-y:auto;max-height:300px;">';
    html += '          <p style="font-size:13px;color:var(--neutral-500);">No transcript available.</p>';
    html += '        </div>';
    html += '      </div>';

    // Actions
    html += '      <div class="drawer-section">';
    html += '        <h3>Actions</h3>';
    html += '        <div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '          <button class="btn btn-secondary btn-sm" id="cdBtnAskPolaris" disabled>Ask Polaris</button>';
    html += '          <button class="btn btn-primary btn-sm" id="cdBtnSchedule">Schedule</button>';
    html += '        </div>';
    html += '      </div>';

    html += '    </div>'; // cdDrawerContent
    html += '  </div>';   // cdDrawerBody
    html += '</div>';     // cdCustomerDrawer

    var container = document.createElement('div');
    container.id = 'cdContainer';
    container.innerHTML = html;
    document.body.appendChild(container);

    _overlayEl = $('cdDrawerOverlay');
    _drawerEl = $('cdCustomerDrawer');

    // Event bindings
    _overlayEl.addEventListener('click', close);
    $('cdDrawerClose').addEventListener('click', close);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') close();
    });

    _injected = true;
  }

  // ── Transcript Rendering (demo-msg style from index.html) ──

  function renderTranscriptBubbles(transcript, customerName) {
    if (!transcript) return '<p style="font-size:13px;color:var(--neutral-500);">No transcript available.</p>';

    var turns;
    try {
      if (typeof transcript === 'string') {
        turns = JSON.parse(transcript);
      } else if (Array.isArray(transcript)) {
        turns = transcript;
      } else {
        return '<p style="font-size:13px;color:var(--neutral-500);">Unrecognized transcript format.</p>';
      }
    } catch (e) {
      // Try legacy line-based format
      if (typeof transcript === 'string' && transcript.indexOf('\n') >= 0) {
        return renderLegacyTranscript(transcript, customerName);
      }
      return '<p style="font-size:13px;color:var(--neutral-500);">Unable to parse transcript.</p>';
    }

    if (!Array.isArray(turns) || turns.length === 0) {
      return '<p style="font-size:13px;color:var(--neutral-500);">No transcript turns found.</p>';
    }

    var firstName = customerName ? customerName.split(' ')[0] : 'Customer';
    var html = '';
    for (var i = 0; i < turns.length; i++) {
      var turn = turns[i];
      var cls = turn.speaker === 'ai' ? 'ai' : (turn.speaker === 'customer' ? 'customer' : 'system');
      var label = cls === 'ai' ? 'AI AGENT' : (cls === 'customer' ? firstName : '');
      var labelHtml = label ? '<div class="demo-msg-label">' + label + '</div>' : '';
      html += '<div class="demo-msg ' + cls + '">' + labelHtml + turn.text + '</div>';
    }
    return html;
  }

  function renderLegacyTranscript(text, customerName) {
    var firstName = customerName ? customerName.split(' ')[0] : 'Customer';
    return text.split('\n').map(function(l) {
      if (l.indexOf('AI:') === 0 || l.indexOf('Agent:') === 0) {
        var colon = l.indexOf(':');
        return '<div class="demo-msg ai"><div class="demo-msg-label">AI AGENT</div>' + l.substring(colon + 1).trim() + '</div>';
      }
      if (l.indexOf('Customer:') === 0) {
        var c = l.indexOf(':');
        return '<div class="demo-msg customer"><div class="demo-msg-label">' + firstName + '</div>' + l.substring(c + 1).trim() + '</div>';
      }
      return '<div class="demo-msg system">' + l + '</div>';
    }).join('');
  }

  // ── Data Fetching ──

  function _authHeaders() {
    var headers = {};
    var token = null;
    try { token = localStorage.getItem('token'); } catch(e) {}
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  function _authFetch(url) {
    return fetch(url, { headers: _authHeaders() }).then(function(r) { return r.json(); });
  }

  function fetchAll(customerId) {
    // Fetch all 4 endpoints in parallel
    return Promise.all([
      _authFetch('/api/v1/customers/' + encodeURIComponent(customerId)),
      _authFetch('/api/v1/opportunities?customerId=' + encodeURIComponent(customerId)),
      _authFetch('/api/v1/financial/estimates?customerId=' + encodeURIComponent(customerId)),
      _authFetch('/api/v1/communications?customerId=' + encodeURIComponent(customerId))
    ]).then(function(results) {
      return {
        customer: results[0],
        opportunities: results[1],
        estimates: results[2],
        communications: results[3]
      };
    });
  }

  function normalizeData(raw) {
    var data = {};

    // Customer
    if (raw.customer && !raw.customer.error) {
      data.name = raw.customer.name || '';
      data.phone = raw.customer.phone || '';
      data.email = raw.customer.email || '';
      data.address = raw.customer.address || '';
      data.status = raw.customer.status || 'active';
      data.totalJobs = raw.customer.totalJobs || 0;
      data.totalRevenue = raw.customer.totalRevenue || 0;
      data.lastInteraction = raw.customer.lastContact || raw.customer.updatedAt || raw.customer.createdAt || null;
    }

    // Opportunities — find the best match for this customer
    var opps = (raw.opportunities && raw.opportunities.opportunities) ? raw.opportunities.opportunities : [];
    if (!Array.isArray(opps) && raw.opportunities && Array.isArray(raw.opportunities)) {
      opps = raw.opportunities;
    }
    var primaryOpp = null;
    if (opps.length > 0) {
      // Prefer open/active opportunities
      for (var i = 0; i < opps.length; i++) {
        var o = opps[i];
        if (!primaryOpp) primaryOpp = o;
        if (o.stage !== 'won' && o.stage !== 'lost' && o.stage !== 'archived') {
          primaryOpp = o;
          break;
        }
      }
    }
    if (primaryOpp) {
      data.service = primaryOpp.title || primaryOpp.service || '';
      data.description = primaryOpp.description || '';
      data.estimatedValue = primaryOpp.estimatedValue || 0;
      data.stage = primaryOpp.stage || 'lead';
      data.closeProbability = primaryOpp.closeProbability != null ? primaryOpp.closeProbability : stageProb(data.stage);
    }

    // Estimates
    var ests = (raw.estimates && raw.estimates.estimates) ? raw.estimates.estimates : [];
    if (!Array.isArray(ests) && raw.estimates && Array.isArray(raw.estimates)) {
      ests = raw.estimates;
    }
    data.estimates = ests;
    if (ests.length > 0 && !data.estimatedValue) {
      data.estimatedValue = ests[0].total || 0;
    }

    // Communications — extract transcripts
    var comms = (raw.communications && raw.communications.communications) ? raw.communications.communications : [];
    if (!Array.isArray(comms) && raw.communications && Array.isArray(raw.communications)) {
      comms = raw.communications;
    }
    data.communications = comms;
    _commIdToTranscript = {};
    for (var j = 0; j < comms.length; j++) {
      var c = comms[j];
      if (c.content) {
        _commIdToTranscript[c.id] = c.content;
      }
    }
    // Transcript selection — strict priority:
    // 1. Newest type==="call" comm with a valid transcript payload
    // 2. Newest any-type comm with a valid transcript payload
    // 3. Otherwise null (empty-state: "No transcript available.")
    // Internal activity records (estimate created, etc.) are NOT transcript candidates.
    data.primaryTranscript = null;
    data.primaryCommId = null;

    function _isValidTranscript(content) {
      if (!content) return false;
      if (typeof content === 'string') {
        try { var p = JSON.parse(content); if (Array.isArray(p) && p.length > 0 && p[0].speaker) return true; } catch(e){}
        // Legacy line-based format check
        if (content.indexOf('\n') >= 0 && (content.indexOf('AI:') >= 0 || content.indexOf('Agent:') >= 0 || content.indexOf('Customer:') >= 0)) return true;
      } else if (Array.isArray(content) && content.length > 0 && content[0].speaker) {
        return true;
      }
      return false;
    }

    // Pass 1: type==="call" with valid transcript
    for (var k = 0; k < comms.length; k++) {
      if (comms[k].type === 'call' && _isValidTranscript(comms[k].content)) {
        data.primaryTranscript = comms[k].content;
        data.primaryCommId = comms[k].id;
        break;
      }
    }
    // Pass 2: any valid transcript (fallback for legacy/non-call records)
    if (!data.primaryTranscript) {
      for (var m = 0; m < comms.length; m++) {
        if (_isValidTranscript(comms[m].content)) {
          data.primaryTranscript = comms[m].content;
          data.primaryCommId = comms[m].id;
          break;
        }
      }
    }

    return data;
  }

  // ── POLARIS Intelligence ──

  function generatePolarisIntel(data) {
    var svc = data.service || 'General';
    var estVal = data.estimatedValue || 500;
    var prob = data.closeProbability || 30;
    var summary = 'New lead for ' + svc + '.';
    if (data.description) {
      summary = capitalizeFirst(data.description.substring(0, 80)) + (data.description.length > 80 ? '\u2026' : '');
    }
    var price = fmtCurrency(estVal);
    var confLabel = prob >= 80 ? 'High' : prob >= 50 ? 'Medium' : 'Low';
    var confClass = confLabel.toLowerCase();
    var action = prob >= 70 ? 'Prioritize immediate follow-up' : prob >= 40 ? 'Schedule estimate visit' : 'Nurture with follow-up call';

    return {
      summary: summary,
      price: price,
      confidenceLabel: confLabel,
      confidenceClass: confClass,
      confidencePct: prob + '%',
      revenue: price + ' \u2014 ' + svc,
      action: action
    };
  }

  // ── Render Pricing Breakdown ──

  function renderPricingBreakdown(estimates) {
    if (!estimates || estimates.length === 0) {
      return '<p style="font-size:13px;color:var(--neutral-500);">No estimate data available.</p>';
    }
    var est = estimates[0];
    if (est.items && Array.isArray(est.items) && est.items.length > 0) {
      var html = '';
      var total = 0;
      est.items.forEach(function(item) {
        var amt = item.amount || item.a || 0;
        var label = item.description || item.label || item.l || 'Item';
        total += amt;
        html += '<div class="drawer-pricing-item"><span>' + label + '</span><span>' + fmtCurrency(amt) + '</span></div>';
      });
      html += '<div class="drawer-pricing-item"><span><strong>Total</strong></span><span><strong>' + fmtCurrency(total) + '</strong></span></div>';
      return html;
    }
    if (est.total) {
      return '<p style="font-size:13px;color:var(--neutral-500);">Est. value: ' + fmtCurrency(est.total) + '</p>';
    }
    return '<p style="font-size:13px;color:var(--neutral-500);">Estimate pending.</p>';
  }

  // ── Public API ──

  function open(customerId) {
    if (!customerId) return;

    // Ensure drawer HTML is injected
    injectDrawerHTML();

    // Show loading
    _overlayEl.classList.add('open');
    _drawerEl.classList.add('open');
    document.body.style.overflow = 'hidden';
    $('cdDrawerContent').style.display = 'none';
    $('cdDrawerLoading').style.display = '';
    $('cdDrawerTitle').textContent = 'Loading\u2026';

    // Fetch all data
    fetchAll(customerId).then(function(raw) {
      var data = normalizeData(raw);
      _currentData = data;
      populateDrawer(data);
    }).catch(function(err) {
      console.error('[CustomerDetail] Fetch error:', err);
      $('cdDrawerLoading').innerHTML = '<p style="color:var(--danger, #ef4444);">Failed to load customer data. Please try again.</p>';
    });
  }

  function populateDrawer(data) {
    $('cdDrawerLoading').style.display = 'none';
    $('cdDrawerContent').style.display = '';
    $('cdDrawerTitle').textContent = data.name || 'Customer Details';

    // Contact Information
    $('cdName').textContent = data.name || '\u2014';
    $('cdPhone').textContent = data.phone || '\u2014';
    $('cdEmail').textContent = data.email || '\u2014';
    $('cdAddress').textContent = data.address || '\u2014';

    // Customer Profile
    $('cdProfileStatus').innerHTML = getStatusBadge(data.status || 'active');
    $('cdProfileJobs').textContent = data.totalJobs || 0;
    $('cdProfileRevenue').textContent = fmtCurrency(data.totalRevenue);
    $('cdProfileLastInteraction').textContent = fmtDate(data.lastInteraction);

    // Job Details
    $('cdService').textContent = data.service || '\u2014';
    $('cdDescription').textContent = data.description ? capitalizeFirst(data.description) : '\u2014';
    $('cdEstValue').textContent = fmtCurrency(data.estimatedValue);
    $('cdStage').textContent = stageLabel(data.stage);
    $('cdProb').textContent = (data.closeProbability != null ? data.closeProbability + '%' : '\u2014');

    // POLARIS Intelligence
    var intel = generatePolarisIntel(data);
    $('cdPolSummary').textContent = intel.summary;
    $('cdPolPrice').textContent = intel.price;
    $('cdPolConfidence').innerHTML = '<span class="polaris-confidence ' + intel.confidenceClass + '">' + intel.confidenceLabel + ' (' + intel.confidencePct + ')</span>';
    $('cdPolRevenue').textContent = intel.revenue;
    $('cdPolAction').textContent = intel.action;

    // Pricing Breakdown
    $('cdPricingBreakdown').innerHTML = renderPricingBreakdown(data.estimates);

    // Transcript
    $('cdTranscript').innerHTML = renderTranscriptBubbles(data.primaryTranscript, data.name);
    $('cdTranscript').scrollTop = 0;
  }

  function close() {
    if (_overlayEl) _overlayEl.classList.remove('open');
    if (_drawerEl) _drawerEl.classList.remove('open');
    document.body.style.overflow = '';
    _currentData = null;
  }

  function selectTranscript(commId) {
    if (!commId || !_currentData) return;
    var transcript = _commIdToTranscript[commId];
    if (transcript) {
      $('cdTranscript').innerHTML = renderTranscriptBubbles(transcript, _currentData.name);
      $('cdTranscript').scrollTop = 0;
    }
  }

  return {
    open: open,
    close: close,
    selectTranscript: selectTranscript
  };
})();
