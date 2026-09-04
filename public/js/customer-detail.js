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
  var _returnFocus = null;
  var _backgroundState = [];
  var _sourceContext = { source: 'customer', communicationId: null };

  // ── Helpers ──

  function $(id) { return document.getElementById(id); }

  function focusableControls() {
    if (!_drawerEl) return [];
    return Array.prototype.slice.call(_drawerEl.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(function(control) { return !control.hidden && control.getAttribute('aria-hidden') !== 'true'; });
  }

  function trapDrawerFocus(event) {
    if (!_drawerEl || _drawerEl.hidden || event.key !== 'Tab') return;
    var controls = focusableControls();
    if (!controls.length) { event.preventDefault(); _drawerEl.focus(); return; }
    var first = controls[0];
    var last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !_drawerEl.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  function setBackgroundInert(inert) {
    var container = document.getElementById('cdContainer');
    if (inert) {
      _backgroundState = Array.prototype.slice.call(document.body.children).filter(function(node) {
        return node && node !== container && node.tagName !== 'SCRIPT' && typeof node.setAttribute === 'function';
      }).map(function(node) {
        var state = { node: node, inert: typeof node.hasAttribute === 'function' && node.hasAttribute('inert') };
        node.setAttribute('inert', '');
        return state;
      });
      return;
    }
    _backgroundState.forEach(function(state) {
      if (!state.inert && state.node && state.node.isConnected && typeof state.node.removeAttribute === 'function') {
        state.node.removeAttribute('inert');
      }
    });
    _backgroundState = [];
  }

  function presentationFormat() {
    return window.NorthStarPresentationFormat || null;
  }

  function describe(value, fallback, key) {
    var formatter = presentationFormat();
    if (formatter && typeof formatter.describe === 'function') {
      return formatter.describe(value, { fallback: fallback, key: key });
    }
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return fallback;
  }

  function escapeText(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
    });
  }

  function fmtCurrency(n) {
    if (n == null || n === '' || typeof n === 'boolean' || !Number.isFinite(Number(n))) {
      return 'Unavailable — no role-authorized amount is recorded.';
    }
    return '$' + Math.round(Number(n)).toLocaleString();
  }

  function fmtDate(val) {
    if (!val) return 'Unavailable — no interaction date is recorded.';
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

  function displayDescription(value) {
    var formatter = presentationFormat();
    var validRecord = formatter && typeof formatter.isRecord === 'function'
      ? formatter.isRecord(value)
      : Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
    if (typeof value !== 'string' && !validRecord) return 'No customer or work description has been recorded.';
    if (formatter && typeof formatter.hasCycle === 'function' && formatter.hasCycle(value)) {
      return 'No customer or work description has been recorded.';
    }
    var text = describe(value, 'No customer or work description has been recorded.', 'description');
    return typeof value === 'string' ? capitalizeFirst(text) : text;
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
    html += '<div class="drawer-overlay" id="cdDrawerOverlay" hidden></div>';
    html += '<div class="customer-drawer" id="cdCustomerDrawer" role="dialog" aria-modal="true" aria-labelledby="cdDrawerTitle" aria-describedby="cdContextSummary cdMissingSummary cdPolarisActionReason" aria-hidden="true" tabindex="-1" hidden>';
    html += '  <div class="drawer-header">';
    html += '    <h2 id="cdDrawerTitle">Customer Details</h2>';
    html += '    <button class="drawer-close drawer-close-btn" id="cdDrawerClose" type="button" aria-label="Close customer details">&times;</button>';
    html += '  </div>';
    html += '  <div class="drawer-body" id="cdDrawerBody">';
    html += '    <p class="drawer-context-summary" id="cdContextSummary">Loading the selected customer context.</p>';
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
    html += '        <div id="cdNavigationLauncher"></div>';
    html += '      </div>';

    // Customer Profile
    html += '      <div class="drawer-section" id="cdProfileSection">';
    html += '        <h3>Customer Profile</h3>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Status</span><span class="drawer-detail-value" id="cdProfileStatus">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Total Jobs</span><span class="drawer-detail-value" id="cdProfileJobs">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Total Revenue</span><span class="drawer-detail-value" id="cdProfileRevenue">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Last Interaction</span><span class="drawer-detail-value" id="cdProfileLastInteraction">\u2014</span></div>';
    html += '        <p class="drawer-missing-summary" id="cdMissingSummary" role="status" aria-live="polite" hidden></p>';
    html += '      </div>';

    // Job Details
    html += '      <div class="drawer-section">';
    html += '        <h3 id="cdJobSectionHeading">Job Details</h3>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Service</span><span class="drawer-detail-value" id="cdService">\u2014</span></div>';
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
    html += '          <details class="drawer-polaris-analysis">';
    html += '            <summary>Work scope and estimate factors</summary>';
    html += '            <div class="drawer-work-details" aria-label="Recorded work scope and estimate factors">';
    html += '              <section class="drawer-work-detail"><h4>Description</h4><p id="cdDescription">No customer or work description has been recorded.</p></section>';
    html += '              <section class="drawer-work-detail"><h4>Gates and missing information</h4><p id="cdWorkGates">No missing-input guidance is recorded.</p></section>';
    html += '              <section class="drawer-work-detail"><h4>Materials</h4><p id="cdWorkMaterials">Material requirements are unavailable because they have not been recorded.</p></section>';
    html += '              <section class="drawer-work-detail"><h4>Equipment</h4><p id="cdWorkEquipment">Equipment requirements are unavailable because they have not been recorded.</p></section>';
    html += '              <section class="drawer-work-detail"><h4>Scheduling</h4><p id="cdWorkScheduling">Scheduling inputs are unavailable because they have not been recorded.</p></section>';
    html += '              <section class="drawer-work-detail"><h4>Pricing</h4><p id="cdWorkPricing">Pricing is unavailable because a role-authorized estimate has not been recorded.</p></section>';
    html += '              <section class="drawer-work-detail"><h4>Risk</h4><p id="cdWorkRisk">No specific risk is supported by the current recorded inputs.</p></section>';
    html += '            </div>';
    html += '          </details>';
    html += '          <details class="drawer-polaris-pricing">';
    html += '            <summary>Complete price breakdown</summary>';
    html += '            <div id="cdPricingBreakdown"><p>No role-authorized estimate factors are available.</p></div>';
    html += '          </details>';
    html += '        </div>';
    html += '      </div>';

    // Complete customer communication history. The source page decides whether
    // this section is primary; every entry is rendered as text, never markup.
    html += '      <div class="drawer-section drawer-conversation-history" id="cdConversationHistorySection" hidden>';
    html += '        <h3>Conversation History</h3>';
    html += '        <p id="cdConversationHistoryStatus" role="status" aria-live="polite">Loading this customer\'s prior communications.</p>';
    html += '        <ol id="cdConversationHistory"></ol>';
    html += '      </div>';

    // Call Transcript
    html += '      <div class="drawer-section">';
    html += '        <h3 id="cdTranscriptHeading" tabindex="-1">Call Transcript</h3>';
    html += '        <div class="drawer-transcript" id="cdTranscript" style="display:flex;flex-direction:column;gap:10px;overflow-y:auto;max-height:300px;">';
    html += '          <p style="font-size:13px;color:var(--neutral-500);">No transcript available.</p>';
    html += '        </div>';
    html += '      </div>';

    // Actions
    html += '      <div class="drawer-section">';
    html += '        <h3>Actions</h3>';
    html += '        <div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '          <button class="btn btn-secondary btn-sm" id="cdBtnAskPolaris" aria-describedby="cdPolarisActionReason" disabled>Ask Polaris</button>';
    html += '          <button class="btn btn-primary btn-sm" id="cdBtnSchedule" aria-describedby="cdPolarisActionReason">Schedule</button>';
    html += '          <p class="drawer-action-reason" id="cdPolarisActionReason">Actions become available after this customer record finishes loading.</p>';
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
    _overlayEl.addEventListener('click', function(event) { event.preventDefault(); close(); });
    $('cdDrawerClose').addEventListener('click', function(event) { event.preventDefault(); event.stopPropagation(); close(); });
    document.addEventListener('keydown', function(e) {
      if (!_drawerEl || _drawerEl.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      trapDrawerFocus(e);
    });
    $('cdBtnSchedule').addEventListener('click', function() {
      if (!_currentData) return;
      var prefix = window.location.pathname.indexOf('/demo') === 0 ? '/demo' : '/dashboard';
      var query = new URLSearchParams();
      if (_currentData.customerId) query.set('customerId', _currentData.customerId);
      if (_currentData.leadId) query.set('leadId', _currentData.leadId);
      window.location.assign(prefix + '/calendar' + (query.toString() ? '?' + query.toString() : ''));
    });
    $('cdBtnAskPolaris').addEventListener('click', function() {
      if (!_currentData) return;
      var prefix = window.location.pathname.indexOf('/demo') === 0 ? '/demo' : '/dashboard';
      var identifier = _currentData.leadId || _currentData.customerId;
      var kind = _currentData.leadId ? 'lead' : 'customer';
      window.location.assign(prefix + '/polaris?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(identifier));
    });

    _injected = true;
  }

  // ── Shared Transcript Rendering ──

  function renderTranscript(transcript, customerName) {
    var firstName = customerName ? customerName.split(' ')[0] : 'Customer';
    return window.NorthStarTranscriptRenderer.render($('cdTranscript'), transcript, {
      labels: { ai: 'AI AGENT', customer: firstName, system: '' },
      messages: {
        missing: 'No transcript available.',
        unrecognized: 'Unrecognized transcript format.',
        parseError: 'Unable to parse transcript.',
        empty: 'No transcript turns found.'
      },
      scroll: 'top',
      live: 'polite'
    });
  }

  function communicationDate(communication) {
    var canonical = communication && communication.canonical;
    var timestamps = canonical && canonical.timestamps;
    return communication && (communication.occurredAt || communication.createdAt) ||
      timestamps && (timestamps.communicationOccurredAt || timestamps.communicationCreatedAt) || null;
  }

  function renderCommunicationHistory(data) {
    var section = $('cdConversationHistorySection');
    var list = $('cdConversationHistory');
    var status = $('cdConversationHistoryStatus');
    var communications = Array.isArray(data.communications) ? data.communications : [];
    section.hidden = _sourceContext.source !== 'communications';
    list.replaceChildren();
    if (section.hidden) {
      status.textContent = '';
      return;
    }
    if (!communications.length) {
      status.textContent = 'No prior communications are recorded for this customer.';
      return;
    }
    communications.forEach(function(communication, index) {
      var item = document.createElement('li');
      item.className = 'drawer-conversation-history-item';
      var channel = describe(communication.channel || communication.type, 'Communication', 'channel');
      var direction = describe(communication.direction, '', 'direction');
      var occurredAt = communicationDate(communication);
      var title = document.createElement('h4');
      title.textContent = capitalizeFirst(channel) + (direction ? ' · ' + capitalizeFirst(direction) : '') +
        ' · ' + fmtDate(occurredAt);
      var summary = document.createElement('p');
      summary.textContent = describe(communication.subject || communication.summary,
        'No conversation summary has been recorded.', 'subject');
      item.append(title, summary);
      var transcript = communication.transcript && communication.transcript.text;
      if (transcript) {
        var review = document.createElement('button');
        review.type = 'button';
        review.className = 'btn btn-secondary btn-sm drawer-conversation-review';
        review.textContent = 'Review conversation ' + (index + 1);
        review.setAttribute('aria-pressed', communication.id === data.primaryCommId ? 'true' : 'false');
        review.addEventListener('click', function() {
          selectTranscript(communication.id);
          Array.prototype.forEach.call(list.querySelectorAll('.drawer-conversation-review'), function(button) {
            button.setAttribute('aria-pressed', button === review ? 'true' : 'false');
          });
          status.textContent = 'Showing conversation ' + (index + 1) + ' of ' + communications.length + '.';
          $('cdTranscriptHeading').focus({ preventScroll:true });
        });
        item.appendChild(review);
      } else {
        var unavailable = document.createElement('p');
        unavailable.className = 'drawer-conversation-unavailable';
        unavailable.textContent = 'No transcript was recorded for this communication.';
        item.appendChild(unavailable);
      }
      list.appendChild(item);
    });
    status.textContent = communications.length + (communications.length === 1
      ? ' prior communication is available.' : ' prior communications are available.');
  }

  // ── Data Fetching ──

  function _authHeaders() {
    return {};
  }

  function _authFetch(url) {
    return window.NorthStarAccountSession.fetch(url, { headers: _authHeaders() }).then(function(r) { return r.json(); });
  }

  function fetchAll(customerId) {
    if (!window.CanonicalIntelligence) return Promise.reject(new Error('Polaris intelligence is unavailable.'));
    var filters = { customerId: customerId };
    return Promise.all([
      window.CanonicalIntelligence.loadCompatibility('customer-detail', filters),
      window.CanonicalIntelligence.loadCompatibility('leads', filters),
      window.CanonicalIntelligence.loadCompatibility('estimates', filters),
      window.CanonicalIntelligence.loadCompatibility('communications', filters)
    ]).then(function(results) {
      var digest = results[0].digest;
      if (results.some(function(projection) { return projection.digest !== digest; })) {
        throw new Error('Customer intelligence records do not share one graph digest.');
      }
      return {
        customer: results[0].records[0] || null,
        opportunity: results[1].records[0] || null,
        estimate: results[2].records[0] || null,
        communications: results[3].records || [],
        canonical: results[0].items[0] || null,
        digest: digest
      };
    });
  }

  function normalizeData(raw) {
    var data = {};

    if (raw.customer) {
      data.customerId = raw.customer.id || null;
      data.name = raw.customer.name || '';
      data.phone = raw.customer.phone || '';
      data.email = raw.customer.email || '';
      data.address = raw.customer.address || '';
      data.status = raw.customer.status || 'active';
      data.totalJobs = null;
      data.totalRevenue = null;
      data.lastInteraction = null;
    }

    var primaryOpp = raw.opportunity;
    if (primaryOpp) {
      data.leadId = primaryOpp.id || null;
      data.stage = primaryOpp.status || null;
    }

    var presentation = window.PolarisEngine && window.PolarisEngine.selectPresentation(raw.canonical);
    var values = presentation && presentation.values;
    data.canonical = raw.canonical;
    data.intelligence = values || null;
    data.service = presentation ? presentation.serviceText : '';
    data.description = presentation && presentation.service ? presentation.service.scope : null;
    data.estimatedValue = presentation ? presentation.customerPrice : null;
    data.closeProbability = null;
    data.estimates = raw.estimate ? [raw.estimate] : [];

    var comms = Array.isArray(raw.communications) ? raw.communications : [];
    data.communications = comms;
    _commIdToTranscript = {};
    for (var j = 0; j < comms.length; j++) {
      var c = comms[j];
      var transcript = c.transcript && c.transcript.text;
      if (transcript) {
        _commIdToTranscript[c.id] = transcript;
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
      if (comms[k].channel === 'call' && _isValidTranscript(comms[k].transcript && comms[k].transcript.text)) {
        data.primaryTranscript = comms[k].transcript.text;
        data.primaryCommId = comms[k].id;
        break;
      }
    }
    // Pass 2: any valid transcript (fallback for legacy/non-call records)
    if (!data.primaryTranscript) {
      for (var m = 0; m < comms.length; m++) {
        if (_isValidTranscript(comms[m].transcript && comms[m].transcript.text)) {
          data.primaryTranscript = comms[m].transcript.text;
          data.primaryCommId = comms[m].id;
          break;
        }
      }
    }
    if (_sourceContext.source === 'communications' && _sourceContext.communicationId &&
        _commIdToTranscript[_sourceContext.communicationId]) {
      data.primaryTranscript = _commIdToTranscript[_sourceContext.communicationId];
      data.primaryCommId = _sourceContext.communicationId;
    }

    return data;
  }

  function lineItemSummary(values, category, emptyMessage) {
    var lines = values && Array.isArray(values.pricingLineItems) ? values.pricingLineItems : [];
    var matches = lines.filter(function(item) {
      return item && String(item.category || '').toLowerCase().indexOf(category.replace(/s$/, '')) === 0;
    }).map(function(item) {
      var label = describe(item.label || item.code, 'Recorded ' + category, 'label');
      return label + (item.customerCharge == null ? '' : ': ' + fmtCurrency(item.customerCharge));
    });
    return matches.length ? matches.join('; ') : emptyMessage;
  }

  function gateSummary(values) {
    var entries = [];
    (values && Array.isArray(values.missingInformation) ? values.missingInformation : []).forEach(function(item) {
      var value = describe(item, '', 'missingInformation');
      if (value) entries.push(value);
    });
    (values && Array.isArray(values.notCalculated) ? values.notCalculated : []).forEach(function(item) {
      if (!item || typeof item !== 'object') return;
      var formatter = presentationFormat();
      var field = formatter && formatter.label ? formatter.label(item.field || 'Input') : capitalizeFirst(String(item.field || 'Input'));
      var reason = describe(item.reason, 'a required input has not been recorded', 'reason');
      entries.push(field + ' is unavailable because ' + reason.replace(/[.\s]+$/, '') + '.');
    });
    return entries.length ? entries.join(' ') : 'No missing-input gate is recorded for this customer or work item.';
  }

  function workPresentation(data) {
    var values = data.intelligence || {};
    var service = values.service && typeof values.service === 'object' ? values.service : {};
    var scope = service.scope;
    var scheduling = {
      constraint: scope && typeof scope === 'object' ? scope.schedulingConstraint : null,
      estimatedDurationHours: values.estimatedProductionDurationHours,
      travel: values.travel,
    };
    var pricing = {
      customerPrice: values.customerFacingPrice,
      preliminaryRange: values.preliminaryRange,
      tax: values.taxDisposition,
    };
    var materialText = lineItemSummary(values, 'materials', 'Material requirements are unavailable because no material line item has been recorded.');
    if (materialText.indexOf('unavailable') >= 0 && values.materialsCharge != null) {
      materialText = 'Recorded materials charge: ' + fmtCurrency(values.materialsCharge) + '.';
    }
    var equipmentText = lineItemSummary(values, 'equipment', 'Equipment requirements are unavailable because no equipment line item has been recorded.');
    if (equipmentText.indexOf('unavailable') >= 0 && values.equipmentCharge != null) {
      equipmentText = 'Recorded equipment charge: ' + fmtCurrency(values.equipmentCharge) + '.';
    }
    return {
      description: displayDescription(scope),
      gates: gateSummary(values),
      materials: materialText,
      equipment: equipmentText,
      scheduling: describe(scheduling, 'Scheduling inputs are unavailable because they have not been recorded.', 'scheduling'),
      pricing: describe(pricing, 'Pricing is unavailable because a role-authorized estimate has not been recorded.', 'pricing'),
      risk: describe(values.risk, 'No specific risk is supported by the current recorded inputs.', 'risk'),
    };
  }

  // ── POLARIS Intelligence ──

  function generatePolarisIntel(data) {
    var canon = data.intelligence;
    var presentation = window.PolarisEngine && window.PolarisEngine.selectPresentation(canon);
    if (!presentation) return {
      summary: 'Polaris intelligence is unavailable because the required role-authorized inputs were not returned.',
      price: 'Unavailable — no role-authorized price is recorded.',
      confidenceLabel: 'Confidence unavailable', confidenceClass: '',
      confidencePct: 'supporting inputs are incomplete',
      revenue: 'Unavailable — no role-authorized revenue amount is recorded.',
      action: 'Record the missing customer and work inputs before acting.', isCanonical: false
    };
    return {
      summary: presentation.serviceText || 'Recorded service',
      price: presentation.customerPriceRoundedText,
      confidenceLabel: 'Server confidence',
      confidenceClass: '',
      confidencePct: presentation.confidenceText,
      revenue: fmtCurrency(canon.estimatedRevenue),
      action: presentation.recommendedActionText || 'No recommendation recorded',
      isCanonical: true
    };
  }

  // ── Render Pricing Breakdown ──

  function renderPricingBreakdown(estimates) {
    var est = estimates && estimates.length ? estimates[0] : null;
    var presentation = est && window.PolarisEngine && window.PolarisEngine.selectPresentation(est.canonical);
    var values = presentation && presentation.values;
    var items = values && Array.isArray(values.pricingLineItems) ? values.pricingLineItems : [];
    var categories = [
      { key: 'service', label: 'Service And Scope', aliases: ['service', 'servicecharge', 'scope', 'base'] },
      { key: 'labor', label: 'Labor', aliases: ['labor', 'labour'] },
      { key: 'materials', label: 'Materials', aliases: ['material', 'materials'] },
      { key: 'equipment', label: 'Equipment And Machinery', aliases: ['equipment', 'machinery', 'rental'] },
      { key: 'travel', label: 'Travel And Mobilization', aliases: ['travel', 'mobilization', 'distance'] },
      { key: 'fees', label: 'Permits And Fees', aliases: ['permit', 'permits', 'fee', 'fees'] },
      { key: 'markup', label: 'Overhead, Margin, And Adjustments', aliases: ['markup', 'margin', 'overhead', 'adjustment', 'emergency'] }
    ];
    function itemCategory(item) {
      return String(item && (item.category || item.type || item.code) || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    }
    function categoryMarkup(category) {
      var matches = items.filter(function(item) {
        var normalized = itemCategory(item);
        return category.aliases.some(function(alias) { return normalized.indexOf(alias) >= 0; });
      });
      var amount = matches.reduce(function(total, item) { return total + (Number(item.customerCharge) || 0); }, 0);
      var detail = matches.length
        ? matches.map(function(item) { return escapeText(item.label || item.code || category.label); }).join(', ')
        : 'Awaiting a recorded input.';
      return '<section class="drawer-pricing-category" data-pricing-category="' + category.key + '">' +
        '<div class="drawer-pricing-category-header"><span>' + category.label + '</span><span>' + (matches.length ? escapeText(fmtCurrency(amount)) : '\u2014') + '</span></div>' +
        '<p class="drawer-pricing-category-detail">' + detail + '</p></section>';
    }
    var html = '<p class="drawer-pricing-category-detail">Every pricing category stays visible. Missing amounts remain unpriced until a role-authorized business record supplies them.</p>';
    categories.forEach(function(category) { html += categoryMarkup(category); });
    var subtotal = values && Number.isFinite(Number(values.subtotalBeforeTax)) ? fmtCurrency(values.subtotalBeforeTax) : '\u2014';
    html += '<div class="drawer-pricing-item"><span><strong>Recorded subtotal</strong></span><span><strong>' + subtotal + '</strong></span></div>';
    if (values && values.taxDisposition && values.taxDisposition.status === 'calculated') {
      html += '<div class="drawer-pricing-item"><span>Tax</span><span>' + fmtCurrency(values.tax) + '</span></div>';
      html += '<div class="drawer-pricing-item"><span><strong>Recorded total</strong></span><span><strong>' + fmtCurrency(values.totalIncludingTax) + '</strong></span></div>';
    } else {
      var taxReason = values && values.taxDisposition && values.taxDisposition.reason;
      html += '<section class="drawer-pricing-category" data-pricing-category="tax"><div class="drawer-pricing-category-header"><span>Tax</span><span>\u2014</span></div><p class="drawer-pricing-category-detail">' + escapeText(describe(taxReason, 'Awaiting a recorded tax configuration.', 'reason')) + '</p></section>';
      var recordedTotal = presentation && presentation.customerPrice !== null ? presentation.customerPriceRoundedText : '\u2014';
      html += '<div class="drawer-pricing-item"><span><strong>Recorded estimate</strong></span><span><strong>' + escapeText(recordedTotal) + '</strong></span></div>';
    }
    return html;
  }

  // ── Public API ──

  function open(customerId, options) {
    if (!customerId) return;
    options = options || {};
    _sourceContext = {
      source: options.source === 'leads' || options.source === 'communications' ? options.source : 'customer',
      communicationId: typeof options.communicationId === 'string' ? options.communicationId : null
    };

    // Ensure drawer HTML is injected
    injectDrawerHTML();
    _returnFocus = document.activeElement && typeof document.activeElement.focus === 'function'
      ? document.activeElement : null;

    // Show loading
    _overlayEl.classList.add('open');
    _drawerEl.classList.add('open');
    _overlayEl.hidden = false;
    _drawerEl.hidden = false;
    _drawerEl.setAttribute('aria-hidden', 'false');
    _drawerEl.setAttribute('aria-busy', 'true');
    setBackgroundInert(true);
    document.body.style.overflow = 'hidden';
    $('cdDrawerContent').style.display = 'none';
    $('cdDrawerLoading').style.display = '';
    $('cdDrawerTitle').textContent = 'Loading\u2026';
    if (typeof $('cdDrawerClose').focus === 'function') $('cdDrawerClose').focus();

    // Fetch all data
    fetchAll(customerId).then(function(raw) {
      var data = normalizeData(raw);
      _currentData = data;
      populateDrawer(data);
    }).catch(function(err) {
      console.error('[CustomerDetail] Fetch error:', err);
      _drawerEl.setAttribute('aria-busy', 'false');
      var loading = $('cdDrawerLoading');
      while (loading.firstChild) loading.removeChild(loading.firstChild);
      var errorMessage = document.createElement('p');
      errorMessage.style.color = 'var(--danger, #ef4444)';
      errorMessage.setAttribute('role', 'alert');
      errorMessage.textContent = 'Customer details could not be loaded. Close this panel and try again.';
      loading.appendChild(errorMessage);
    });
  }

  function populateDrawer(data) {
    $('cdDrawerLoading').style.display = 'none';
    $('cdDrawerContent').style.display = '';
    $('cdDrawerTitle').textContent = data.name || 'Customer Details';
    _drawerEl.setAttribute('aria-busy', 'false');
    if (_sourceContext.source === 'leads') {
      $('cdContextSummary').textContent = 'Lead inquiry details, recorded work facts, and the actions available for this customer.';
      $('cdJobSectionHeading').textContent = 'Lead Inquiry';
      $('cdTranscriptHeading').textContent = 'Recorded Conversation';
    } else if (_sourceContext.source === 'communications') {
      $('cdContextSummary').textContent = 'Customer information and the complete prior communication history recorded for this customer.';
      $('cdJobSectionHeading').textContent = 'Related Work';
      $('cdTranscriptHeading').textContent = 'Selected Conversation';
    } else {
      $('cdContextSummary').textContent = 'Customer details, recorded work facts, and available actions.';
      $('cdJobSectionHeading').textContent = 'Job Details';
      $('cdTranscriptHeading').textContent = 'Call Transcript';
    }

    // Contact Information
    var missing = [];
    $('cdName').textContent = data.name || '\u2014';
    if (!data.name) missing.push('customer name');
    $('cdPhone').textContent = data.phone || '\u2014';
    if (!data.phone) missing.push('phone number');
    $('cdEmail').textContent = data.email || '\u2014';
    if (!data.email) missing.push('email address');
    var canonicalAddress = typeof data.address === 'string' && data.address.trim()
      ? data.address
      : null;
    var navigationRoot = $('cdNavigationLauncher');
    var navigationLauncher = typeof NorthStarNavigationLauncher === 'undefined'
      ? null
      : NorthStarNavigationLauncher;
    $('cdAddress').textContent = canonicalAddress || '\u2014';
    if (!canonicalAddress) missing.push('service address');
    if (!navigationLauncher || typeof navigationLauncher.mount !== 'function') {
      navigationRoot.className = 'navigation-launcher';
      var navigationStatus = document.createElement('p');
      navigationStatus.className = 'navigation-launcher__status';
      navigationStatus.setAttribute('role', 'status');
      navigationStatus.setAttribute('aria-live', 'polite');
      navigationStatus.textContent = 'Navigation unavailable.';
      navigationRoot.replaceChildren(navigationStatus);
    } else {
      var navigationMount = NorthStarNavigationLauncher.mount(
        navigationRoot,
        { address: data.address, label: 'customer jobsite' }
      );
      $('cdAddress').textContent = navigationMount.destination
        ? navigationMount.destination.address
        : '\u2014';
    }

    // Customer Profile
    $('cdProfileStatus').innerHTML = getStatusBadge(data.status || 'active');
    $('cdProfileJobs').textContent = data.totalJobs == null ? '\u2014' : data.totalJobs;
    if (data.totalJobs == null) missing.push('completed-job count');
    $('cdProfileRevenue').textContent = data.totalRevenue == null ? '\u2014' : fmtCurrency(data.totalRevenue);
    if (data.totalRevenue == null) missing.push('recorded revenue');
    $('cdProfileLastInteraction').textContent = data.lastInteraction ? fmtDate(data.lastInteraction) : '\u2014';
    if (!data.lastInteraction) missing.push('last interaction');
    var missingSummary = $('cdMissingSummary');
    missingSummary.hidden = missing.length === 0;
    missingSummary.textContent = missing.length
      ? 'Not yet recorded: ' + missing.join(', ') + '. Add these details in the customer or work record when they become available.'
      : '';

    // Job Details
    $('cdService').textContent = data.service || 'Unavailable — no service is recorded.';
    var work = workPresentation(data);
    $('cdDescription').textContent = work.description;
    $('cdWorkGates').textContent = work.gates;
    $('cdWorkMaterials').textContent = work.materials;
    $('cdWorkEquipment').textContent = work.equipment;
    $('cdWorkScheduling').textContent = work.scheduling;
    $('cdWorkPricing').textContent = work.pricing;
    $('cdWorkRisk').textContent = work.risk;
    $('cdEstValue').textContent = fmtCurrency(data.estimatedValue);
    $('cdStage').textContent = stageLabel(data.stage);
    $('cdProb').textContent = data.closeProbability != null
      ? data.closeProbability + '%'
      : 'Unavailable — no role-authorized probability is recorded.';

    // POLARIS Intelligence
    var intel = generatePolarisIntel(data);
    $('cdPolSummary').textContent = intel.summary;
    $('cdPolPrice').textContent = intel.price;
    $('cdPolConfidence').textContent = intel.confidenceLabel + ' (' + intel.confidencePct + ')';
    $('cdPolRevenue').textContent = intel.revenue;
    $('cdPolAction').textContent = intel.action;

    // Pricing Breakdown
    $('cdPricingBreakdown').innerHTML = renderPricingBreakdown(data.estimates);

    // Transcript
    renderTranscript(data.primaryTranscript, data.name);
    renderCommunicationHistory(data);

    var identifier = data.leadId || data.customerId;
    var askPolaris = $('cdBtnAskPolaris');
    var schedule = $('cdBtnSchedule');
    var reason = $('cdPolarisActionReason');
    var demo = String(window.location && window.location.pathname || '').indexOf('/demo') === 0;
    askPolaris.disabled = !identifier;
    schedule.disabled = !identifier;
    if (!identifier) {
      reason.textContent = 'These actions require a role-authorized customer or lead identifier. Add the missing record before continuing.';
    } else if (demo) {
      reason.textContent = 'Ask Polaris opens this fictional record. Demo Calendar is read-only; Schedule opens its context without saving a change.';
    } else {
      reason.textContent = 'Ask Polaris keeps this exact record selected. Schedule opens the authorized Calendar flow for this customer.';
    }
  }

  function close() {
    if (_overlayEl) _overlayEl.classList.remove('open');
    if (_drawerEl) _drawerEl.classList.remove('open');
    if (_overlayEl) _overlayEl.hidden = true;
    if (_drawerEl) {
      _drawerEl.hidden = true;
      _drawerEl.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
    setBackgroundInert(false);
    _currentData = null;
    _sourceContext = { source: 'customer', communicationId: null };
    if (_returnFocus && typeof document.contains === 'function' && document.contains(_returnFocus)) _returnFocus.focus();
    _returnFocus = null;
  }

  function selectTranscript(commId) {
    if (!commId || !_currentData) return;
    var transcript = _commIdToTranscript[commId];
    if (transcript) {
      renderTranscript(transcript, _currentData.name);
    }
  }

  return {
    open: open,
    close: close,
    selectTranscript: selectTranscript
  };
})();
