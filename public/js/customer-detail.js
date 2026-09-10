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
  var _openSequence = 0;
  var _reviewSequence = 0;
  var _estimateReview = null;
  var _decisionDraft = null;
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
      return 'Unavailable — no amount is available to this account.';
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

    // POLARIS\u2122 Intelligence
    html += '      <div class="drawer-section" id="cdExecutionSection"><h3>Work details</h3><div id="cdExecutionRecords"></div></div>';
    html += '      <div class="drawer-section">';
    html += '        <h3>POLARIS\u2122 Intelligence</h3>';
    html += '        <div class="drawer-polaris-insight" id="cdPolarisInsight">';
    html += '          <div class="drawer-polaris-grid">';
    html += '            <div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Job</div><div class="drawer-polaris-item-value" id="cdPolSummary">\u2014</div></div>';
    html += '            <div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Original estimate</div><div class="drawer-polaris-item-value" id="cdPolPrice">\u2014</div></div>';
    html += '            <div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Recorded input score</div><div class="drawer-polaris-item-value" id="cdPolConfidence">\u2014</div></div>';
    html += '            <div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Recommended Action</div><div class="drawer-polaris-item-value" id="cdPolAction">\u2014</div></div>';
    html += '          </div>';
    html += '          <p class="drawer-polaris-basis">Original estimate guidance, before any later material changes or human price review. The input score reflects recorded detail completeness and conflicting facts, not price accuracy.</p>';
    html += '          <div class="drawer-polaris-context"><span>Stage: <strong id="cdStage"></strong></span><span id="cdProbabilityRow">Close probability: <strong id="cdProb"></strong></span></div>';
    html += '          <details class="drawer-polaris-analysis">';
    html += '            <summary>Work scope and estimate factors</summary>';
    html += '            <div class="drawer-work-details" aria-label="Recorded work scope and estimate factors">';
    html += '              <section class="drawer-work-detail"><h4>Recorded scope</h4><ul class="drawer-work-facts" id="cdDescription"><li>No customer or work description has been recorded.</li></ul></section>';
    html += '              <section class="drawer-work-detail"><h4>Needs review</h4><ul class="drawer-work-facts" id="cdWorkGates"><li>No missing-input guidance is recorded.</li></ul></section>';
    html += '              <section class="drawer-work-detail"><h4>Materials</h4><ul class="drawer-work-facts" id="cdWorkMaterials"><li>Material requirements are unavailable because they have not been recorded.</li></ul></section>';
    html += '              <section class="drawer-work-detail"><h4>Equipment</h4><ul class="drawer-work-facts" id="cdWorkEquipment"><li>Equipment requirements are unavailable because they have not been recorded.</li></ul></section>';
    html += '              <section class="drawer-work-detail"><h4>Scheduling</h4><ul class="drawer-work-facts" id="cdWorkScheduling"><li>Scheduling inputs are unavailable because they have not been recorded.</li></ul></section>';
    html += '              <section class="drawer-work-detail"><h4>Pricing</h4><ul class="drawer-work-facts" id="cdWorkPricing"><li>No recorded estimate is available to this account.</li></ul></section>';
    html += '              <section class="drawer-work-detail"><h4>Risk</h4><ul class="drawer-work-facts" id="cdWorkRisk"><li>No specific risk is supported by the current recorded inputs.</li></ul></section>';
    html += '            </div>';
    html += '          </details>';
    html += '          <details class="drawer-polaris-pricing">';
    html += '            <summary>Estimate costs and price review</summary>';
    html += '            <p>Original price breakdown. Material changes and human price decisions are shown in the estimate review below.</p><div id="cdPricingBreakdown"><p>No estimate details are available to this account.</p></div>';
    html += '            <section aria-label="Estimate review" style="margin-top:1rem">';
    html += '              <h4>Estimate review</h4><div id="cdEstimateReview" role="status" aria-live="polite"></div>';
    html += '              <button type="button" class="btn btn-secondary btn-sm" id="cdEstimateReviewRefresh" style="margin-top:1rem">Refresh estimate review</button>';
    html += '              <div id="cdEstimateDecision" style="margin-top:1rem"></div>';
    html += '              <section id="cdCapellaReview" class="drawer-capella-review" aria-labelledby="cdCapellaTitle" hidden></section>';
    html += '            </section>';

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
    html += '      <details class="drawer-section drawer-transcript-disclosure" id="cdTranscriptDisclosure">';
    html += '        <summary id="cdTranscriptHeading">Call Transcript</summary>';
    html += '        <div class="drawer-transcript" id="cdTranscript" style="display:flex;flex-direction:column;gap:10px;overflow-y:auto;max-height:300px;">';
    html += '          <p style="font-size:13px;color:var(--neutral-500);">No transcript available.</p>';
    html += '        </div>';
    html += '      </details>';

    // Actions
    html += '      <div class="drawer-section">';
    html += '        <h3>Actions</h3>';
    html += '        <div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '          <button class="btn btn-secondary btn-sm" id="cdBtnAskPolaris" aria-describedby="cdPolarisActionReason" disabled>Ask Polaris</button>';
    html += '          <button class="btn btn-primary btn-sm" id="cdBtnSchedule" aria-describedby="cdPolarisActionReason">Schedule</button>';
    html += '          <button type="button" class="btn btn-secondary btn-sm" id="cdBtnContact" aria-expanded="false" aria-controls="cdContactMethods">Contact</button>';
    html += '          <div id="cdContactMethods" class="drawer-contact-methods" hidden></div>';
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

    // Approved customer-card hierarchy, using the existing shared controls/data.
    var content = $('cdDrawerContent'), panel = $('cdPolarisInsight');
    var polarisSection = panel.parentElement;
    var brand = polarisSection.querySelector('h3'); panel.prepend(brand);
    var headerMeta = document.createElement('div'); headerMeta.className = 'drawer-header-meta';
    headerMeta.append($('cdPolSummary'), $('cdStage'));
    var sourceBadge = document.createElement('span'); sourceBadge.id = 'cdDemoBadge'; sourceBadge.className = 'drawer-demo-badge'; sourceBadge.textContent = 'Demo'; sourceBadge.hidden = true; headerMeta.appendChild(sourceBadge);
    var identity = document.createElement('div'); identity.className = 'drawer-identity';
    var header = _drawerEl.querySelector('.drawer-header'); identity.append($('cdDrawerTitle'),headerMeta); header.prepend(identity);
    var serviceAddress = document.createElement('p'); serviceAddress.id = 'cdServiceAddress'; serviceAddress.className = 'drawer-service-address'; identity.appendChild(serviceAddress);
    var priceBox = $('cdPolPrice').parentElement; priceBox.classList.add('drawer-primary-estimate');
    var range = document.createElement('div'); range.id = 'cdPolRange'; range.className = 'drawer-original-range'; priceBox.appendChild(range);
    var confidenceNode = $('cdPolConfidence'), actionNode = $('cdPolAction');
    $('cdPolarisInsight').querySelector('.drawer-polaris-grid').replaceChildren(priceBox);
    var analysis = panel.querySelector('.drawer-polaris-analysis'); analysis.open = true;
    analysis.querySelector('summary').textContent = 'Scope Details';
    var scopeSection = $('cdDescription').parentElement; scopeSection.querySelector('h4').remove();
    var travelSection = $('cdWorkScheduling').parentElement; travelSection.querySelector('h4').remove();
    var charges = document.createElement('section'); charges.className = 'drawer-work-detail drawer-original-charges';
    var chargeTitle = document.createElement('h4'); chargeTitle.id = 'cdChargeHeading'; chargeTitle.textContent = 'Original charge details'; charges.appendChild(chargeTitle);
    charges.append($('cdWorkMaterials').parentElement, $('cdWorkEquipment').parentElement);
    var attention = document.createElement('section'); attention.className = 'drawer-card-note'; attention.id = 'cdAttentionSection';
    var attentionTitle = document.createElement('h3'); attentionTitle.textContent = 'Needs Attention'; attention.append(attentionTitle,$('cdWorkGates'));
    var riskNode = $('cdWorkRisk');
    var nextAction = document.createElement('section'); nextAction.className = 'drawer-card-note';
    var nextTitle = document.createElement('h3'); nextTitle.textContent = 'Next Action'; nextAction.append(nextTitle,actionNode);
    var basisDetails = document.createElement('details'); basisDetails.className = 'drawer-estimate-basis';
    var basisTitle = document.createElement('summary'); basisTitle.textContent = 'How To Read This Estimate';
    basisDetails.append(basisTitle,confidenceNode,panel.querySelector('.drawer-polaris-basis'),riskNode);
    var neutralContext = document.createElement('p'); neutralContext.id = 'cdNeutralContext'; basisDetails.appendChild(neutralContext);
    panel.querySelector('.drawer-work-details').replaceChildren(scopeSection);
    var travelDetails = document.createElement('details'); travelDetails.className = 'drawer-polaris-subsection'; travelDetails.id = 'cdTravelDetails';
    var travelTitle = document.createElement('summary'); travelTitle.textContent = 'Travel And Work Time'; travelDetails.append(travelTitle,travelSection);
    var chargeDetails = document.createElement('details'); chargeDetails.className = 'drawer-polaris-subsection'; chargeDetails.id = 'cdChargeDetails';
    var chargeSummary = document.createElement('summary'); chargeSummary.textContent = 'Original Charge Details'; chargeDetails.append(chargeSummary,charges);
    panel.append(travelDetails,chargeDetails);
    panel.appendChild(basisDetails);
    var priceDetails = panel.querySelector('.drawer-polaris-pricing'); priceDetails.classList.add('drawer-section');
    priceDetails.querySelector('summary').textContent = 'Price Breakdown And Estimate Review';
    panel.append(priceDetails,basisDetails);
    var contactSection = $('cdName').closest('.drawer-section'), profileSection = $('cdProfileSection');
    var contactDetails = document.createElement('details'); contactDetails.className = 'drawer-section drawer-customer-background';
    var contactTitle = document.createElement('summary'); contactTitle.textContent = 'Contact And Customer History';
    contactDetails.append(contactTitle,contactSection,profileSection);
    contactDetails.appendChild($('cdProbabilityRow'));
    panel.querySelector('.drawer-polaris-context').remove();
    var actionSection = $('cdBtnAskPolaris').closest('.drawer-section'); actionSection.classList.add('drawer-primary-actions');
    content.prepend(actionSection,polarisSection);
    polarisSection.after(attention,nextAction,$('cdExecutionSection'),$('cdTranscriptDisclosure'),contactDetails);
    $('cdContextSummary').hidden = true;

    // Event bindings
    $('cdBtnContact').addEventListener('click', function() {
      var expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', String(!expanded));
      $('cdContactMethods').hidden = expanded;
    });
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
    var simulated = window.NorthStarDemoRuntime && window.NorthStarDemoRuntime.active;
    if (simulated) $('cdTranscriptHeading').textContent = 'Simulated Call Transcript';
    var firstName = customerName ? customerName.split(' ')[0] : 'Customer';
    return window.NorthStarTranscriptRenderer.render($('cdTranscript'), transcript, {
      labels: { ai: 'AI AGENT', customer: firstName, system: '' },
      messages: {
        missing: simulated ? 'This older demo example has no saved conversation. Use Reset Demo in the demo toolbar to create new examples with simulated calls. Reset replaces the current demo and clears its changes.' : 'No transcript available.',
        unrecognized: 'Unrecognized transcript format.',
        parseError: 'Unable to parse transcript.',
        empty: simulated ? 'This older demo example has no saved conversation. Reset Demo creates new examples and clears the current demo changes.' : 'No transcript turns found.'
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
        canonicalRecords: results[0].items || [],
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
    data.canonicalRecords = raw.canonicalRecords || [];
    data.intelligence = values || null;
    data.service = presentation ? presentation.serviceText : '';
    data.description = presentation && presentation.service ? presentation.service.scope : null;
    // Only the selected job's recorded scope, or the isolated demo graph's
    // validated jobsite binding, may supply the prominent service address.
    data.serviceAddress = data.description && typeof data.description.address === 'string' ? data.description.address.trim() : '';
    if (!data.serviceAddress && window.location.pathname.indexOf('/demo') === 0 && typeof data.address === 'string') data.serviceAddress = data.address.trim();
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
    var prompts = {
      vehicleCost:'Vehicle and fuel expenses need separate review; the estimate may not include them.', fuelCost:'Vehicle and fuel expenses need separate review; the estimate may not include them.',
      callDurationSeconds:'Call length was not recorded.', actualCrewAssignment:'Confirm the crew and appointment before scheduling.',
      appointmentPreference:'Confirm the crew and appointment before scheduling.', crewRecommendation:'Review the crew needed for this work.',
      customerFacingPrice:'Review the missing job and price inputs before quoting.', preliminaryRange:'A price range is not available.',
      equipmentCharge:'Review the equipment charge.', equipmentReference:'Confirm suitable equipment for the job.',
      estimatedProductionDurationHours:'Confirm the expected work duration.', laborHours:'Confirm the labor hours.',
      laborCharge:'Review the labor charge.', materialsCharge:'Review the material charge.',
      knownDirectMaterialCost:'Material cost is missing.', knownEquipmentCost:'Equipment cost is missing.',
      knownInternalLaborCost:'Labor cost is missing.', knownTravelInternalCost:'Travel cost is missing.',
      knownDirectCosts:'Direct costs are incomplete; review missing costs before relying on profit figures.',
      grossMargin:'Profit and margin figures are incomplete; review the missing costs.', grossProfit:'Profit and margin figures are incomplete; review the missing costs.',
      netMargin:'Profit and margin figures are incomplete; review the missing costs.', netProfit:'Profit and margin figures are incomplete; review the missing costs.', overhead:'Overhead is not included.',
      tax:'Confirm tax treatment before quoting.', totalIncludingTax:'A tax-inclusive total is unavailable.',
      travelCustomerCharge:'Confirm travel distance, time and any customer charge.', travelDistanceMiles:'Confirm travel distance, time and any customer charge.',
      travelMinutes:'Confirm travel distance, time and any customer charge.', travelSource:'Confirm travel distance, time and any customer charge.'
    };
    var entries = [];
    (values && Array.isArray(values.missingInformation) ? values.missingInformation : []).forEach(function(item) {
      if (typeof item === 'string') entries.push('Confirm ' + describe(item, 'the missing job detail', 'detail') + '.');
      else if (item && typeof item === 'object' && item.field !== 'callDurationSeconds') entries.push(prompts[item.field] || 'Review the missing job details before committing to work.');
    });
    (values && Array.isArray(values.notCalculated) ? values.notCalculated : []).forEach(function(item) {
      if (item && typeof item === 'object' && item.field !== 'callDurationSeconds') entries.push(prompts[item.field] || 'Some estimate details are unavailable. Review the recorded job information.');
    });
    return entries.length ? entries.filter(function(value,index,list) { return list.indexOf(value) === index; }) : ['No missing information is recorded for this work.'];
  }

  function renderWorkFacts(id, value) {
    var root = $(id); root.replaceChildren();
    var entries = Array.isArray(value) ? value : [value];
    (entries.length ? entries : ['Not recorded']).forEach(function(text) {
      var item = document.createElement('li');
      var separator = String(text).indexOf(': ');
      if (separator > 0 && id !== 'cdWorkGates' && id !== 'cdWorkRisk') {
        var label = document.createElement('span'); label.className = 'drawer-fact-label'; label.textContent = text.slice(0,separator);
        var value = document.createElement('span'); value.className = 'drawer-fact-value'; value.textContent = text.slice(separator+2);
        if (id === 'cdDescription' && /^(work type|material|equipment|service area|fixture|system type|leak severity)$/i.test(text.slice(0,separator))) value.classList.add('drawer-fact-categorical');
        item.append(label,value);
      } else item.textContent = text;
      root.appendChild(item);
    });
  }

  function workPresentation(data) {
    var values = data.intelligence || {}, service = values.service || {}, scope = service.scope;
    function measured(value, unit) { return typeof value === 'number' && Number.isFinite(value) ? value + ' ' + unit : 'Not recorded'; }
    function cost(value) { return value == null ? 'Not recorded' : fmtCurrency(value); }
    var labels = { customerDistanceMiles:'Customer distance', equipmentReference:'Equipment', jobType:'Work type', laborHours:'Labor time', serviceRadiusMiles:'Service radius', serviceZone:'Service area', linearFeet:'Length', estimatedDurationHours:'Estimated duration' };
    var units = { customerDistanceMiles:'miles', serviceRadiusMiles:'miles', linearFeet:'ft', laborHours:'hours', estimatedDurationHours:'hours' };
    var scopeFacts = scope && typeof scope === 'object' && !Array.isArray(scope) ? Object.keys(scope).filter(function(key) { return key !== 'timeZone' && (!presentationFormat().isInternalKey(key) || key === 'equipmentReference'); }).map(function(key) {
      var label = labels[key] || presentationFormat().label(key);
      return label + ': ' + (units[key] ? measured(scope[key],units[key]) : describe(scope[key],'Not recorded',key));
    }) : [displayDescription(scope)];
    var travel = values.travel || {};
    return {
      description:scopeFacts,
      gates:gateSummary(values),
      materials:[cost(values.materialsCharge)],
      equipment:[cost(values.equipmentCharge)],
      scheduling:['Estimated work: '+measured(values.estimatedProductionDurationHours,'hours'),'Travel distance: '+measured(travel.distanceMiles,'miles'),'Travel time: '+measured(travel.minutes,'minutes'),'Original travel charge: '+cost(travel.customerCharge),'Recorded travel cost: '+cost(travel.knownInternalCost)],
      pricing:['Original estimate: '+cost(values.customerFacingPrice),'Original price range: '+(values.preliminaryRange ? cost(values.preliminaryRange.low)+' to '+cost(values.preliminaryRange.high) : 'Not recorded'),'Tax: '+(values.taxDisposition && values.taxDisposition.status==='calculated' ? cost(values.tax) : 'Needs review')],
      risk:[values.risk && typeof values.risk.emergency === 'boolean' ? (values.risk.emergency ? 'Emergency reported. Review the recorded details before committing to work.' : 'No emergency is recorded. Other job risks still require review.') : 'Risk information is not recorded. Review job risks before committing to work.']
    };
  }

  // ── POLARIS Intelligence ──

  function generatePolarisIntel(data) {
    var canon = data.intelligence;
    var presentation = window.PolarisEngine && window.PolarisEngine.selectPresentation(canon);
    if (!presentation) return {
      summary: 'Polaris advice is unavailable because the required job information could not be loaded.',
      price: 'Unavailable — no price is available to this account.',
      confidenceLabel: 'Confidence unavailable', confidenceClass: '',
      confidencePct: 'supporting inputs are incomplete',
      revenue: 'Unavailable — no revenue amount is available to this account.',
      action: 'Record the missing customer and work inputs before acting.', isCanonical: false
    };
    return {
      summary: presentation.serviceText || 'Recorded service',
      price: presentation.customerPriceRoundedText,
      confidenceLabel: 'Input score',
      confidenceClass: '',
      confidencePct: canon.calculationVersion === 'm19-part3-canonical-v2' ? presentation.confidenceText : 'not assessed',
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
      { key: 'service', label: 'Service And Scope' },
      { key: 'labor', label: 'Labor' },
      { key: 'materials', label: 'Materials' },
      { key: 'equipment', label: 'Equipment And Machinery' },
      { key: 'travel', label: 'Travel And Mobilization' },
      { key: 'fees', label: 'Permits And Fees' },
      { key: 'markup', label: 'Overhead, Margin, And Adjustments' },
      { key: 'other', label: 'Other Recorded Charges' }
    ];
    function normalized(value) {
      return String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    }
    function containsAny(value, aliases) {
      return aliases.some(function(alias) { return value.indexOf(alias) >= 0; });
    }
    function itemCategory(item) {
      var meaning = [item && item.code, item && item.label, item && item.type].map(normalized).join(' ');
      var authority = normalized(item && item.category);
      // Code and label are more specific than the broad canonical serviceCharge
      // bucket. For example, a permit can validly be stored as serviceCharge,
      // but it must still be disclosed to the owner under Permits And Fees.
      if (containsAny(meaning, ['permit', 'licensefee', 'inspectionfee', 'filingfee'])) return 'fees';
      if (containsAny(meaning, ['labor', 'labour', 'technicianhour', 'crewhour'])) return 'labor';
      if (containsAny(meaning, ['material', 'supply'])) return 'materials';
      if (containsAny(meaning, ['equipment', 'machinery', 'rental', 'tooling'])) return 'equipment';
      if (containsAny(meaning, ['travel', 'mobilization', 'distance', 'mileage', 'tripcharge'])) return 'travel';
      if (containsAny(meaning, ['markup', 'margin', 'overhead', 'adjustment', 'emergency'])) return 'markup';
      if (containsAny(meaning, ['service', 'scope', 'base', 'diagnostic'])) return 'service';
      if (authority === 'labor' || authority === 'labour') return 'labor';
      if (authority === 'material' || authority === 'materials') return 'materials';
      if (authority === 'equipment' || authority === 'machinery') return 'equipment';
      if (authority === 'travel' || authority === 'mobilization') return 'travel';
      if (authority === 'permit' || authority === 'permits' || authority === 'fee' || authority === 'fees') return 'fees';
      if (authority === 'markup' || authority === 'margin' || authority === 'overhead' || authority === 'adjustment') return 'markup';
      if (authority === 'service' || authority === 'servicecharge' || authority === 'scope' || authority === 'base') return 'service';
      return 'other';
    }
    function categoryMarkup(category) {
      var matches = items.filter(function(item) {
        return itemCategory(item) === category.key;
      });
      var amount = matches.reduce(function(total, item) { return total + (Number(item.customerCharge) || 0); }, 0);
      var detail = matches.length
        ? matches.map(function(item) { return escapeText(item.label || item.code || category.label); }).join(', ')
        : 'Awaiting a recorded input.';
      return '<section class="drawer-pricing-category" id="cdPricingCategory-' + category.key + '" data-pricing-category="' + category.key + '">' +
        '<div class="drawer-pricing-category-header"><span>' + category.label + '</span><span>' + (matches.length ? escapeText(fmtCurrency(amount)) : '\u2014') + '</span></div>' +
        '<p class="drawer-pricing-category-detail">' + detail + '</p></section>';
    }
    var html = '<p class="drawer-pricing-category-detail">Missing amounts remain unpriced until the required company information is available.</p>';
    categories.forEach(function(category) { if (items.some(function(item) { return itemCategory(item) === category.key; })) html += categoryMarkup(category); });
    if (!items.length) html += '<p class="drawer-pricing-category-detail">No itemized charges are recorded.</p>';
    var unpriced = categories.filter(function(category) { return !items.some(function(item) { return itemCategory(item) === category.key; }); });
    if (unpriced.length && items.length) html += '<details class="drawer-unpriced-categories"><summary>Categories without a recorded amount</summary><ul>' + unpriced.map(function(category) { return '<li>' + escapeText(category.label) + '</li>'; }).join('') + '</ul></details>';

    var subtotal = values && values.subtotalBeforeTax != null && Number.isFinite(Number(values.subtotalBeforeTax)) ? fmtCurrency(values.subtotalBeforeTax) : '\u2014';
    html += '<div class="drawer-pricing-item"><span><strong>Original subtotal</strong></span><span><strong>' + subtotal + '</strong></span></div>';
    if (values && values.taxDisposition && values.taxDisposition.status === 'calculated') {
      html += '<div class="drawer-pricing-item"><span>Tax</span><span>' + fmtCurrency(values.tax) + '</span></div>';
      html += '<div class="drawer-pricing-item"><span><strong>Original total</strong></span><span><strong>' + fmtCurrency(values.totalIncludingTax) + '</strong></span></div>';
    } else {
      var taxReason = values && values.taxDisposition && values.taxDisposition.reason;
      html += '<section class="drawer-pricing-category" data-pricing-category="tax"><div class="drawer-pricing-category-header"><span>Tax</span><span>\u2014</span></div><p class="drawer-pricing-category-detail">' + 'Tax treatment needs review before quoting.' + '</p></section>';
      var recordedTotal = presentation && presentation.customerPrice !== null ? presentation.customerPriceRoundedText : '\u2014';
      html += '<div class="drawer-pricing-item"><span><strong>Original estimate</strong></span><span><strong>' + escapeText(recordedTotal) + '</strong></span></div>';
    }
    return html;
  }

  // ── Public API ──

  function open(customerId, options) {
    if (!customerId) return;
    var generation = ++_openSequence;
    if (window.NorthStarExecutionLinks) window.NorthStarExecutionLinks.clear($('cdExecutionRecords'));
    options = options || {};
    _sourceContext = {
      source: options.source === 'leads' || options.source === 'communications' ? options.source : 'customer',
      communicationId: typeof options.communicationId === 'string' ? options.communicationId : null
    };

    _decisionDraft = null; _materialPlanDraft = null; _adoptionDraft = null; _selectedEstimateRevision = null; _estimateReview = null;
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
      if (generation !== _openSequence || !_drawerEl || _drawerEl.hidden) return;
      var data = normalizeData(raw);
      _currentData = data;
      populateDrawer(data);
    }).catch(function(err) {
      if (generation !== _openSequence || !_drawerEl || _drawerEl.hidden) return;
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

  function decisionMoney(value, currency) {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(value)) return 'Unavailable';
    var parts = value.split('.'); return currency + ' ' + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
  }

  function decisionReviewBasis(review) {
    var state = review.decisions, current = state.writeBasis || state.current;
    return JSON.stringify({ pins: review.pins, recordedAt: review.recordedAt, currency: review.currency,
      revision: current ? current.revision : 0, digest: current ? current.digest : 'none',
      demoRevision: review.demoWorkspaceRevision, canApprove: state.canApprove, canWithdraw: state.canWithdraw });
  }

  function focusDecisionAction(action) {
    var target = $(action === 'withdraw' ? 'cdDecisionWithdrawAction' : 'cdDecisionReviewAction') || $('cdDecisionReviewAction') || $('cdEstimateReviewRefresh');
    if (target) target.focus();
  }

  function renderEstimateDecision(review) {
    var root = $('cdEstimateDecision'); root.replaceChildren();
    var state = review.decisions;
    if (!state) { root.textContent = 'Decision history is unavailable. Refresh before approving this estimate.'; return; }
    function text(value) { var p = document.createElement('p'); p.style.margin = '0 0 0.75rem'; p.textContent = value; root.appendChild(p); return p; }
    function button(label, action, id) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-secondary btn-sm'; b.style.margin = '0.5rem 0.5rem 0 0'; b.textContent = label; b.id = id; b.onclick = action; root.appendChild(b); return b; }
    if (state.current && state.current.action === 'approve') {
      text('Human-reviewed price before tax: ' + decisionMoney(state.current.priceBeforeTax, state.current.currency));
      text('Reviewed scope: ' + state.current.scopeSummary);
    }
    if (state.recoveryMessage) text(state.recoveryMessage);
    if (state.canApprove && !_decisionDraft) button(state.current && state.current.action === 'approve' ? 'Revise scope and price' : 'Review scope and price', function () { beginEstimateDecision('approve'); }, 'cdDecisionReviewAction');
    if (state.canWithdraw && !_decisionDraft) button('Withdraw approval', function () { beginEstimateDecision('withdraw'); }, 'cdDecisionWithdrawAction');
    if (state.history && state.history.length) {
      var history = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Decision history'; history.appendChild(summary);
      var list = document.createElement('ol');
      state.history.forEach(function (entry, index) { var item = document.createElement('li'); item.style.margin = '0.75rem 0'; var date = new Date(entry.createdAt);
        item.textContent = (index === 0 ? 'Current: ' : 'Earlier: ') + (entry.action === 'withdraw' ? 'Approval withdrawn' : 'Approved for quote preparation: ' + decisionMoney(entry.priceBeforeTax, entry.currency)) + ' by ' + entry.actorName + ' on ' + (Number.isFinite(date.getTime()) ? date.toLocaleString() : 'an unavailable date') + '. ' + entry.reason + (entry.action === 'approve' ? ' Scope: ' + entry.scopeSummary : ''); list.appendChild(item); });
      history.appendChild(list); if (state.truncated) { var note = document.createElement('p'); note.textContent = 'Showing the 20 most recent decisions out of ' + state.total + '.'; history.appendChild(note); } root.appendChild(history);
    }
    if (_decisionDraft && _decisionDraft.estimateId === review.pins.estimateId && state.canApprove) renderDecisionForm();
  }

  function beginEstimateDecision(action) {
    if (!_estimateReview || !_estimateReview.decisions) return;
    var current = _estimateReview.decisions.current;
    _decisionDraft = { estimateId: _estimateReview.pins.estimateId, action: action,
      basis: decisionReviewBasis(_estimateReview), basisChanged: false, scope: current && current.action === 'approve' ? current.scopeSummary : '',
      price: current && current.action === 'approve' ? current.priceBeforeTax : '', reason: '', confirmed: false, request: null };
    renderEstimateDecision(_estimateReview);
    var control = $('cdDecisionScope') || $('cdDecisionReason'); if (control) control.focus();
  }

  function renderDecisionForm() {
    var root = $('cdEstimateDecision'), draft = _decisionDraft, form = document.createElement('form'); form.id = 'cdDecisionForm'; form.style.marginTop = '1rem';
    function field(label, id, value, multiline) { var group = document.createElement('label'); group.style.display = 'block'; group.style.marginBottom = '0.75rem'; group.textContent = label;
      var input = document.createElement(multiline ? 'textarea' : 'input'); input.id = id; input.value = value; input.required = true; input.style.display = 'block'; input.style.width = '100%'; input.style.boxSizing = 'border-box'; input.style.padding = '0.75rem'; input.style.color = '#172033'; input.style.background = '#fff'; group.appendChild(input); form.appendChild(group); return input; }
    if (draft.action === 'approve') {
      var scope = field('Reviewed work scope', 'cdDecisionScope', draft.scope, true); scope.maxLength = 4000; scope.oninput = function () { draft.scope = scope.value; draft.request = null; };
      var price = field('Reviewed price before tax (' + _estimateReview.currency + ')', 'cdDecisionPrice', draft.price, false); price.inputMode = 'decimal'; price.pattern = '(0|[1-9][0-9]{0,11})\\.[0-9]{2}'; price.placeholder = '0.00'; price.oninput = function () { draft.price = price.value; draft.request = null; };
    }
    var reason = field('Reason for this decision', 'cdDecisionReason', draft.reason, true); reason.maxLength = 2000; reason.oninput = function () { draft.reason = reason.value; draft.request = null; };
    var label = document.createElement('label'), confirm = document.createElement('input'); confirm.type = 'checkbox'; confirm.id = 'cdDecisionConfirm'; confirm.required = true; confirm.checked = draft.confirmed; confirm.onchange = function () { draft.confirmed = confirm.checked; draft.request = null; }; label.appendChild(confirm);
    label.appendChild(document.createTextNode(draft.action === 'approve' ? ' I reviewed this recorded estimate, its missing information, the work scope and price. Approve these details for quote preparation only; nothing will be sent.' : ' Withdraw the current approval. Its history will remain, and these details will no longer be approved for quote preparation.')); form.appendChild(label);
    var status = document.createElement('p'); status.id = 'cdDecisionStatus'; status.setAttribute('role', 'status'); status.tabIndex = -1; if (draft.basisChanged) status.textContent = 'The saved review changed. Check your entries and confirm again before saving.'; status.style.marginTop = '0.75rem'; form.appendChild(status);
    var save = document.createElement('button'); save.type = 'submit'; save.className = 'btn btn-secondary btn-sm'; save.textContent = draft.action === 'approve' ? 'Approve for quote preparation' : 'Confirm withdrawal'; form.appendChild(save);
    var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-secondary btn-sm'; cancel.textContent = 'Cancel'; cancel.style.marginLeft = '0.75rem'; cancel.onclick = function () { _decisionDraft = null; renderEstimateDecision(_estimateReview); focusDecisionAction(draft.action); }; form.appendChild(cancel);
    form.onsubmit = function (event) {
      event.preventDefault(); if (!form.reportValidity() || !_estimateReview || !reviewPinsMatch(_estimateReview, _currentData && _currentData.canonical)) return;
      var review = _estimateReview, generation = _openSequence, state = review.decisions, current = state.writeBasis || state.current;
      if (!draft.request) draft.request = { key: crypto.randomUUID(), body: { action: draft.action, expectedRevision: current ? current.revision : 0, expectedDigest: current ? current.digest : 'none', sourcePins: review.pins,
        scopeSummary: draft.action === 'approve' ? draft.scope.trim() : null, priceBeforeTax: draft.action === 'approve' ? draft.price : null, currency: review.currency, reason: draft.reason.trim(), confirmed: draft.confirmed, confirmationVersion: 'estimate-quote-preparation-v1' }, demoRevision: review.demoWorkspaceRevision };
      var attempt = draft.request; Array.prototype.forEach.call(form.elements, function (control) { control.disabled = true; }); status.textContent = 'Saving decision.';
      var headers = { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key }; if (review.simulated) headers['X-NorthStar-Demo-Revision'] = String(attempt.demoRevision);
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/' + encodeURIComponent(draft.estimateId) + '/decisions', { method: 'POST', headers: headers, body: JSON.stringify(attempt.body) }).then(function (response) {
        if (!response.ok) { var error = new Error('save failed'); error.status = response.status; throw error; } return response.json();
      }).then(function () { if (generation !== _openSequence || _decisionDraft !== draft) return; _decisionDraft = null; refreshEstimateReview('decision-saved'); }).catch(function (error) {
        if (generation !== _openSequence || _decisionDraft !== draft) return;
        status.textContent = error.status === 401 ? 'Your session ended. Sign in again, then reopen this estimate to review and confirm your decision.' : error.status === 409 ? 'The review changed. Refresh the estimate, check your entries and confirm again before saving.' : error.status === 403 ? 'Your current account cannot save this decision.' : error.status === 400 ? 'Check the scope, price and confirmation before saving.' : error.status === 429 ? (review.simulated ? 'This demo has reached an action limit. Review the saved history and try again later.' : 'This estimate has reached its decision limit. Review the saved history or contact support.') : error.status === 503 ? 'New decisions are unavailable. Refresh this estimate to check its saved decisions before trying again.' : 'The save could not be confirmed. Retry without changing your entries to check this same attempt.';
        if ([401, 403, 429, 503].indexOf(error.status) !== -1) { draft.confirmed = false; confirm.checked = false; }
        status.focus();
        if (error.status === 409) { draft.confirmed = false; confirm.checked = false; draft.request = null; }
      }).finally(function () { if (generation === _openSequence && _decisionDraft === draft) Array.prototype.forEach.call(form.elements, function (control) { control.disabled = false; }); });
    };
    root.appendChild(form);
  }

  function reviewPinsMatch(review, selected) {
    var p = review && review.pins, ids = selected && selected.ids, profile = selected && selected.businessProfile;
    return review && review.contract === 'NorthStarEstimateReview/v1' && p && ids && profile &&
      p.estimateId === ids.estimate && p.graphId === ids.graph && p.customerId === ids.customer &&
      p.operationId === ids.operation && p.opportunityId === ids.opportunity &&
      JSON.stringify(p.supportingFactIds) === JSON.stringify(selected.supportingTranscriptFactIds || []) &&
      p.snapshotId === ids.polarisSnapshot && p.snapshotDigest === selected.snapshotDigest &&
      p.calculationVersion === selected.calculationVersion &&
      p.normalizedInputFingerprint === selected.normalizedInputFingerprint &&
      p.businessProfileId === profile.id && p.businessProfileVersion === profile.version && p.businessProfileHash === profile.hash &&
      (p.revision ? review.originalRecordedAt === selected.snapshotCreatedAt && p.revision.number === review.selectedRevision && p.revision.calculationVersion === 'estimate-material-adoption-v1' : review.recordedAt === selected.snapshotCreatedAt);
  }

  var _materialPlanDraft = null, _adoptionDraft = null, _selectedEstimateRevision = null;
  function materialPlanBasis(review) {
    var plan=review.materialPlans;
    return JSON.stringify({pins:review.pins,decision:plan&&plan.decisionBasis,current:plan&&plan.current&&{id:plan.current.id,revision:plan.current.revision,digest:plan.current.digest},allowed:plan&&plan.canMutate,currency:review.currency});
  }
  function renderMaterialPlan(review,parent) {
    var plans=review.materialPlans,root=document.createElement('section');root.id='cdMaterialPlan';parent.appendChild(root);
    function para(text){var p=document.createElement('p');p.textContent=text;p.style.overflowWrap='anywhere';root.appendChild(p);return p;}
    function button(label,handler){var b=document.createElement('button');b.type='button';b.className='btn btn-secondary btn-sm';b.textContent=label;b.style.margin='0.5rem 0.5rem 0 0';b.onclick=handler;root.appendChild(b);return b;}
    if(!plans||plans.contract!=='estimate-material-plan-v1'||JSON.stringify(plans.sourcePins)!==JSON.stringify(review.pins)||plans.simulated!==review.simulated){para('Material planning is unavailable. Refresh this estimate.');return;}
    var current=plans.current;
    function showResult(result,target){var p=document.createElement('p');p.textContent='Required: '+result.quantity+' '+result.unitLabel+'. Extra for waste: '+result.additionalQuantity+' '+result.unitLabel+'. Planned quantity: '+result.plannedQuantity+' '+result.unitLabel+'. Price per unit: '+decisionMoney(result.unitPrice,result.currency)+'. Planned material cost: '+decisionMoney(result.total,result.currency)+'. '+result.rounding;p.style.overflowWrap='anywhere';target.appendChild(p);}
    if(current&&current.action==='save'){
      para('Latest material plan: '+current.inputs.material);showResult(current.result,root);
      para(!current.sourceBasisCurrent?'This plan was saved for a different estimate in this job’s history.':current.expectedDecisionRevision===0&&plans.decisionBasis.revision===0?'No human scope and price decision was recorded when this plan was saved.':current.decisionBasisCurrent?'Saved with the selected estimate’s current scope and price decision.':'The scope and price decision has changed since this plan was saved. Review the plan again before using it.');
      para('Saving or editing a material plan does not automatically change an estimate or customer price.');
      para('Price source: '+(current.inputs.sourceType==='my_estimate'?'My cost estimate. ':'Price information entered by a person. ')+current.inputs.sourceNote+' Price date: '+(current.inputs.priceDate||'Not provided')+'. Availability has not been verified.');
    }else para(current?'The material plan was withdrawn. Its history remains available.':'No material plan has been saved for this estimate.');
    if(plans.history.length){var history=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Material plan history';history.appendChild(summary);plans.history.forEach(function(e){var p=document.createElement('p');p.textContent=(e.action==='save'?'Saved material plan':'Withdrew material plan')+' — '+e.actorName+' — '+new Date(e.createdAt).toLocaleString()+(e.result?' — '+decisionMoney(e.result.total,e.currency):'')+'. '+e.reason;history.appendChild(p);});if(plans.truncated){var note=document.createElement('p');note.textContent='Showing the latest 20 entries. Earlier history is retained.';history.appendChild(note);}root.appendChild(history);}
    if(!plans.canMutate){para(plans.mutationsPaused?'New material plans are paused. Saved plans and history remain available.':'Material plans are read-only here. Saved plans and history remain available.');return;}
    function start(action){_materialPlanDraft={action:action,estimateId:review.pins.estimateId,basis:materialPlanBasis(review),inputs:current&&current.inputs?JSON.parse(JSON.stringify(current.inputs)):{material:review.materialReview.material||'',quantity:'',unit:'ea',wastePercent:'',unitPrice:'',sourceType:'my_estimate',sourceNote:'',priceDate:null},reason:'',confirmed:false,result:null,request:null};render();var mountedForm=$('cdMaterialPlanForm');var first=mountedForm&&mountedForm.querySelector('input,select');if(first)first.focus();}
    function render(){root.remove();renderMaterialPlan(review,parent);}
    if(!_materialPlanDraft){button(current&&current.action==='save'?'Revise material plan':'Plan material cost',function(){start('save');});if(current&&current.action==='save')button('Withdraw material plan',function(){start('withdraw');});return;}
    var draft=_materialPlanDraft;if(draft.estimateId!==review.pins.estimateId){_materialPlanDraft=null;render();return;}
    if(draft.basis!==materialPlanBasis(review)){draft.basis=materialPlanBasis(review);draft.confirmed=false;draft.result=null;draft.request=null;draft.changed=true;}
    var form=document.createElement('form');form.id='cdMaterialPlanForm';root.appendChild(form);
    function field(label,id,value,type){var wrap=document.createElement('label');wrap.textContent=label;wrap.style.display='block';wrap.style.marginTop='0.75rem';var input=document.createElement(type==='select'?'select':'input');input.id=id;input.value=value||'';input.style.cssText='display:block;width:100%;box-sizing:border-box;padding:0.65rem;color:#172033;background:white;color-scheme:light;';if(type!=='select')input.type=type||'text';wrap.appendChild(input);form.appendChild(wrap);return input;}
    function invalidate(){draft.confirmed=false;draft.result=null;draft.request=null;confirm.checked=false;result.replaceChildren();}
    if(draft.action==='save'){
      var material=field('Material','cdPlanMaterial',draft.inputs.material);material.maxLength=160;material.required=true;material.oninput=function(){draft.inputs.material=material.value;invalidate();};
      var unit=field('Unit','cdPlanUnit',draft.inputs.unit,'select');[['ea','Items'],['m','Metres'],['m2','Square metres'],['m3','Cubic metres'],['ft','Feet'],['ft2','Square feet'],['ft3','Cubic feet'],['yd3','Cubic yards'],['kg','Kilograms'],['lb','Pounds'],['l','Litres'],['gal','US liquid gallons']].forEach(function(x){var o=document.createElement('option');o.value=x[0];o.textContent=x[1];unit.appendChild(o);});unit.value=draft.inputs.unit;
      var quantity=field('Required quantity','cdPlanQuantity',draft.inputs.quantity);quantity.inputMode='decimal';quantity.required=true;quantity.oninput=function(){draft.inputs.quantity=quantity.value;invalidate();};
      var waste=field('Waste allowance (%)','cdPlanWaste',draft.inputs.wastePercent);waste.inputMode='decimal';waste.required=true;waste.oninput=function(){draft.inputs.wastePercent=waste.value;invalidate();};
      var price=field('Internal price per selected unit ('+review.currency+')','cdPlanPrice',draft.inputs.unitPrice);price.inputMode='decimal';price.required=true;price.placeholder='0.00';price.oninput=function(){draft.inputs.unitPrice=price.value;invalidate();};
      unit.onchange=function(){draft.inputs.unit=unit.value;draft.inputs.quantity='';draft.inputs.unitPrice='';quantity.value='';price.value='';invalidate();status.textContent='The unit changed. Enter the quantity and price for this unit.';};
      var source=field('Price source','cdPlanSourceType',draft.inputs.sourceType,'select');[['my_estimate','My cost estimate'],['entered_price','Price information I entered']].forEach(function(x){var o=document.createElement('option');o.value=x[0];o.textContent=x[1];source.appendChild(o);});source.value=draft.inputs.sourceType;source.onchange=function(){draft.inputs.sourceType=source.value;invalidate();};
      var note=field('Source note','cdPlanSourceNote',draft.inputs.sourceNote);note.maxLength=1000;note.required=true;note.oninput=function(){draft.inputs.sourceNote=note.value;invalidate();};
      var date=field('Price date (optional)','cdPlanPriceDate',draft.inputs.priceDate,'date');date.oninput=function(){draft.inputs.priceDate=date.value||null;invalidate();};
    }
    var reason=field('Reason for this plan change','cdPlanReason',draft.reason);reason.maxLength=2000;reason.required=true;reason.oninput=function(){draft.reason=reason.value;draft.confirmed=false;confirm.checked=false;draft.request=null;};
    var result=document.createElement('div');result.id='cdPlanResult';result.setAttribute('aria-live','polite');form.appendChild(result);if(draft.result)showResult(draft.result,result);
    var label=document.createElement('label'),confirm=document.createElement('input');confirm.id='cdPlanConfirm';confirm.type='checkbox';confirm.checked=draft.confirmed;confirm.onchange=function(){draft.confirmed=confirm.checked;draft.request=null;};label.appendChild(confirm);label.appendChild(document.createTextNode(draft.action==='save'?' I reviewed these material inputs and their source. Save this plan without changing the estimate or customer price.':' Withdraw this material plan while retaining its history.'));form.appendChild(label);
    var status=document.createElement('p');status.id='cdPlanStatus';status.setAttribute('role','status');status.tabIndex=-1;status.textContent=draft.changed?'The review changed. Calculate again and confirm this plan.':'';form.appendChild(status);
    function body(){return {action:draft.action,expectedRevision:current?current.revision:0,expectedDigest:current?current.digest:'none',sourcePins:review.pins,expectedDecisionRevision:plans.decisionBasis.revision,expectedDecisionDigest:plans.decisionBasis.digest,inputs:draft.action==='save'?draft.inputs:null,currency:review.currency,reason:draft.reason,confirmed:draft.confirmed,confirmationVersion:'estimate-material-plan-v1'};}
    function focusStart(){var b=parent.querySelector('#cdMaterialPlan button');if(b)b.focus();}
    function send(preview){if(!form.reportValidity()||!reviewPinsMatch(review,_currentData&&_currentData.canonical))return;if(!preview&&(!draft.confirmed||draft.action==='save'&&!draft.result)){status.textContent='Calculate the material cost and confirm the plan before saving.';return;}
      var generation=_openSequence,attempt=preview?{body:body()}:draft.request||(draft.request={body:JSON.parse(JSON.stringify(body())),key:crypto.randomUUID(),demoRevision:review.demoWorkspaceRevision});var serialized=JSON.stringify(attempt.body);Array.prototype.forEach.call(form.elements,function(c){c.disabled=true;});status.textContent=preview?'Calculating material cost.':'Saving material plan.';
      var headers={'Content-Type':'application/json'};if(!preview)headers['Idempotency-Key']=attempt.key;if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(preview?review.demoWorkspaceRevision:attempt.demoRevision);
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/material-plan-preview':'/material-plans'),{method:'POST',headers:headers,body:serialized}).then(function(response){return response.json().catch(function(){return {};}).then(function(b){if(!response.ok)throw {status:response.status};return b;});}).then(function(b){if(generation!==_openSequence||_materialPlanDraft!==draft||_estimateReview!==review)return;if(preview){if(!b.success||JSON.stringify(b.data.sourcePins)!==JSON.stringify(review.pins)||!b.data.decisionBasis||b.data.decisionBasis.revision!==plans.decisionBasis.revision||b.data.decisionBasis.digest!==plans.decisionBasis.digest)throw {status:409};draft.result=b.data.result;draft.confirmed=false;confirm.checked=false;result.replaceChildren();showResult(draft.result,result);status.textContent='Review this calculation, then confirm to save.';}else{_materialPlanDraft=null;refreshEstimateReview('material-saved');}}).catch(function(error){if(generation!==_openSequence||_materialPlanDraft!==draft||_estimateReview!==review)return;var known=[400,401,403,409,429,503].indexOf(error.status)>=0;status.textContent=error.status===400?'Check the material values and source, then calculate again.':error.status===401?'Sign in again before saving this plan.':error.status===403?'Your current account cannot save material plans.':error.status===409?'The estimate or review changed. Refresh, calculate again and confirm.':error.status===429?'The material-plan limit was reached. Review saved history before continuing.':error.status===503?'Material planning is unavailable. Refresh to read the saved plan.':'The result is unconfirmed. Retry this same attempt before changing the plan.';if(known){draft.confirmed=false;confirm.checked=false;draft.result=null;draft.request=null;result.replaceChildren();}}).finally(function(){if(generation===_openSequence&&_materialPlanDraft===draft&&_estimateReview===review){Array.prototype.forEach.call(form.elements,function(c){c.disabled=false;});status.focus();}});
    }
    function formButton(label,handler){var b=document.createElement('button');b.type='button';b.className='btn btn-secondary btn-sm';b.textContent=label;b.style.margin='0.75rem 0.5rem 0 0';b.onclick=handler;form.appendChild(b);}
    if(draft.action==='save')formButton('Calculate material cost',function(){send(true);});formButton(draft.action==='save'?'Save material plan':'Confirm material withdrawal',function(){send(false);});formButton('Cancel material plan',function(){_materialPlanDraft=null;render();focusStart();});form.onsubmit=function(e){e.preventDefault();};
  }

  function renderRevisionSelector(review,parent) {
    if (!review.currentRevision) return;
    var label=document.createElement('label');label.textContent='Estimate history';label.style.cssText='display:block;margin-bottom:0.75rem;';
    var select=document.createElement('select');select.id='cdEstimateRevisionSelect';select.style.cssText='display:block;max-width:100%;padding:0.65rem;color:#172033;background:white;color-scheme:light;';
    function option(value,text){var o=document.createElement('option');o.value=String(value);o.textContent=text;select.appendChild(o);}
    (review.revisionHistory||[]).forEach(function(entry){var date=new Date(entry.createdAt);option(entry.revision,(entry.revision===review.currentRevision?'Current estimate':'Earlier estimate')+(Number.isFinite(date.getTime())?' — '+date.toLocaleString():''));});
    option(1,'Original estimate'+(review.currentRevision===1?' (current)':''));select.value=String(review.selectedRevision);
    select.onchange=function(){_selectedEstimateRevision=Number(select.value);_decisionDraft=null;_materialPlanDraft=null;_adoptionDraft=null;refreshEstimateReview('revision-selected');};label.appendChild(select);parent.appendChild(label);
    if(!review.isCurrent){var note=document.createElement('p');note.textContent='Viewing an earlier estimate. Select the current estimate to make changes.';parent.appendChild(note);}
  }
  function renderMaterialAdoption(review,parent) {
    var root=document.createElement('section');root.id='cdMaterialAdoption';parent.appendChild(root);
    function para(value){var p=document.createElement('p');p.textContent=value;p.style.overflowWrap='anywhere';root.appendChild(p);return p;}
    function button(label,fn,id){var b=document.createElement('button');b.type='button';b.className='btn btn-secondary btn-sm';b.textContent=label;b.id=id||'';b.style.margin='0.5rem 0.5rem 0 0';b.onclick=fn;root.appendChild(b);return b;}
    var plan=review.materialPlans&&review.materialPlans.current;
    if(review.adoptionPaused){para('New estimate changes are paused. Saved estimates remain available.');return;}
    if(!review.canAdopt||!plan||plan.action!=='save')return;
    if(JSON.stringify(plan.sourcePins)!==JSON.stringify(review.pins)){para('Save the material plan against this current estimate before including it.');return;}
    var basis=materialPlanBasis(review);
    if(_adoptionDraft&&_adoptionDraft.basis!==basis){_adoptionDraft.result=null;_adoptionDraft.confirmed=false;_adoptionDraft.request=null;_adoptionDraft.basis=basis;_adoptionDraft.changed=true;}
    function redraw(){root.remove();renderMaterialAdoption(review,parent);}
    if(!_adoptionDraft){button('Use material plan in estimate',function(){_adoptionDraft={basis:basis,reason:'',confirmed:false,result:null,request:null};redraw();$('cdAdoptionReason').focus();},'cdAdoptionStart');return;}
    var draft=_adoptionDraft,form=document.createElement('form');form.id='cdAdoptionForm';root.appendChild(form);
    var intro=document.createElement('p');intro.textContent='Replace this estimate’s material cost with the saved plan. The original estimate stays in history. Review the job and price again afterward.';form.appendChild(intro);
    var label=document.createElement('label');label.textContent='Reason for using this plan';label.style.display='block';
    var reason=document.createElement('textarea');reason.id='cdAdoptionReason';reason.required=true;reason.maxLength=2000;reason.value=draft.reason;reason.style.cssText='display:block;width:100%;box-sizing:border-box;padding:0.65rem;color:#172033;background:white;';label.appendChild(reason);form.appendChild(label);
    var result=document.createElement('p');result.id='cdAdoptionResult';form.appendChild(result);
    function showResult(){result.textContent=draft.result?'New material cost: '+decisionMoney(draft.result.knownDirectMaterialCost,review.currency)+'. New recorded direct costs: '+decisionMoney(draft.result.knownDirectCosts,review.currency)+'. Original price and tax stay unchanged.':'';}showResult();
    var confirmLabel=document.createElement('label'),confirm=document.createElement('input');confirm.id='cdAdoptionConfirm';confirm.type='checkbox';confirm.checked=draft.confirmed;confirmLabel.appendChild(confirm);confirmLabel.appendChild(document.createTextNode(' I reviewed these costs and want to use this material plan in a new estimate.'));form.appendChild(confirmLabel);
    var status=document.createElement('p');status.id='cdAdoptionStatus';status.setAttribute('role','status');status.tabIndex=-1;status.textContent=draft.changed?'The saved information changed. Preview and confirm again.':'';form.appendChild(status);
    reason.oninput=function(){draft.reason=reason.value;draft.confirmed=false;confirm.checked=false;draft.result=null;draft.request=null;showResult();};confirm.onchange=function(){draft.confirmed=confirm.checked;draft.request=null;};
    function formButton(text,fn){var b=document.createElement('button');b.type='button';b.className='btn btn-secondary btn-sm';b.textContent=text;b.style.margin='0.5rem 0.5rem 0 0';b.onclick=fn;form.appendChild(b);}
    function send(preview){
      if(!form.reportValidity())return;if(!preview&&(!draft.result||!draft.confirmed)){status.textContent='Preview the costs, then confirm before saving.';status.focus();return;}
      var body={sourcePins:review.pins,expectedPlanId:plan.id,expectedPlanRevision:plan.revision,expectedPlanDigest:plan.digest,expectedDecisionRevision:review.decisions.writeBasis.revision,expectedDecisionDigest:review.decisions.writeBasis.digest,reason:draft.reason.trim(),confirmed:preview?false:draft.confirmed,confirmationVersion:'estimate-material-adoption-v1'};
      if(!preview&&!draft.request)draft.request={key:crypto.randomUUID(),body:body,demoRevision:review.demoWorkspaceRevision};
      var attempt=preview?{key:crypto.randomUUID(),body:body,demoRevision:review.demoWorkspaceRevision}:draft.request;
      var headers={'Content-Type':'application/json','Idempotency-Key':attempt.key};if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(attempt.demoRevision);
      var generation=_openSequence;Array.prototype.forEach.call(form.elements,function(c){c.disabled=true;});status.textContent=preview?'Preparing cost review.':'Saving estimate.';
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/material-adoption-preview':'/material-adoptions'),{method:'POST',headers:headers,body:JSON.stringify(attempt.body)}).then(function(response){return response.json().catch(function(){return {};}).then(function(data){if(!response.ok)throw {status:response.status};return data;});}).then(function(data){
        if(generation!==_openSequence||_adoptionDraft!==draft||_estimateReview!==review)return;
        if(preview){if(!data.success||JSON.stringify(data.data.sourcePins)!==JSON.stringify(review.pins)||data.data.planId!==plan.id||data.data.planDigest!==plan.digest||JSON.stringify(data.data.decisionBasis)!==JSON.stringify(review.decisions.writeBasis))throw {status:409};draft.result=data.data.result;draft.confirmed=false;confirm.checked=false;showResult();status.textContent='Review these costs, then confirm to save.';}
        else{_adoptionDraft=null;_decisionDraft=null;_materialPlanDraft=null;_selectedEstimateRevision=null;refreshEstimateReview('adoption-saved');}
      }).catch(function(error){if(generation!==_openSequence||_adoptionDraft!==draft||_estimateReview!==review)return;
        status.textContent=error.status===401?'Sign in again, then reopen this estimate.':error.status===403?'Your current account cannot change this estimate.':error.status===409?'The estimate or material plan changed. Refresh and review again.':error.status===400?'Check the material plan and reason before continuing.':error.status===429?'The estimate-change limit was reached. Review the saved history.':error.status===503?'New estimate changes are unavailable. Refresh to check the saved estimate.':'The save could not be confirmed. Retry this same attempt before changing your entries.';
        if([400,401,403,409,429,503].indexOf(error.status)>=0){draft.confirmed=false;confirm.checked=false;draft.result=null;draft.request=null;showResult();}
      }).finally(function(){if(generation===_openSequence&&_adoptionDraft===draft&&_estimateReview===review){Array.prototype.forEach.call(form.elements,function(c){c.disabled=false;});status.focus();}});
    }
    formButton('Preview estimate costs',function(){send(true);});formButton('Save new estimate',function(){send(false);});formButton('Cancel estimate change',function(){_adoptionDraft=null;redraw();var start=$('cdAdoptionStart');if(start)start.focus();});form.onsubmit=function(e){e.preventDefault();};
  }

  function renderMaterialReview(review, parent) {
    var details = document.createElement('details'); details.id = 'cdMaterialReview';
    var summary = document.createElement('summary'); summary.textContent = 'Material basis'; details.appendChild(summary);
    function paragraph(text) { var node = document.createElement('p'); node.textContent = text; node.style.overflowWrap = 'anywhere'; details.appendChild(node); }
    var material = review.materialReview;
    var matches = material && material.contract === 'NorthStarMaterialReview/v1' &&
      JSON.stringify(material.sourcePins) === JSON.stringify(review.pins) && material.recordedAt === review.recordedAt &&
      material.currency === review.currency && material.simulated === review.simulated;
    if (review.adoptedMaterialPlan) {
      var adopted=review.adoptedMaterialPlan,inputs=adopted.inputs;
      paragraph('Included material: '+inputs.material+'. Recorded material cost: '+decisionMoney(review.financialCosts.knownDirectMaterialCost,review.currency)+'.');
      paragraph('Required quantity: '+inputs.quantity+' '+review.financialCosts.material.unitLabel+'. Waste allowance: '+inputs.wastePercent+'%. Planned quantity: '+review.financialCosts.material.plannedQuantity+'.');
      paragraph('Entered unit price: '+decisionMoney(inputs.unitPrice,review.currency)+'. '+inputs.sourceNote);
      paragraph(inputs.priceDate?'Entered price date: '+inputs.priceDate+'. Current availability is unverified.':'The price date and current availability are unverified.');
      if(review.materialPlans&&review.materialPlans.current&&review.materialPlans.current.id!==adopted.id)paragraph('The material plan has changed since it was included. This estimate keeps the plan shown above until you deliberately use a newer plan.');
    } else if (!matches) paragraph('Material information is unavailable. Refresh this estimate to try again.');
    else {
      paragraph(material.materialState === 'recorded' && typeof material.material === 'string' ? 'Material: ' + material.material : material.materialState === 'unspecified' ? 'Material not specified.' : 'The material description is unavailable.');
      paragraph('Recorded material cost: ' + decisionMoney(material.amount, review.currency));
      paragraph(material.basis === 'recorded_configured_amount' ? 'This is the material amount saved for this estimate, not a current supplier price.' : 'The basis of this material amount is unavailable. Review it before relying on it.');
      var date = material.recordedAt && new Date(material.recordedAt);
      paragraph(date && Number.isFinite(date.getTime()) ? 'Estimate recorded ' + date.toLocaleString() + '.' : 'The estimate recording date is unavailable.');
      paragraph('The recorded estimate does not include material quantity, units or waste allowance.');
      paragraph('The price date and current availability are unverified. Confirm both before relying on this amount.');
      if (material.simulated) paragraph('This example uses fictional material information.');
    }
    renderMaterialPlan(review,details);
    renderMaterialAdoption(review,details);
    parent.appendChild(details);
  }

  function renderCapellaReview(review) {
    var root = $('cdCapellaReview'); root.replaceChildren(); root.hidden = false;
    var title = document.createElement('h4'); title.id = 'cdCapellaTitle'; title.textContent = 'Capella\u2122 Risk Lens'; root.appendChild(title);
    function paragraph(value) { var p = document.createElement('p'); p.textContent = value; root.appendChild(p); }
    var risk = review.riskReview, decision = review.decisions && review.decisions.current;
    var matches = risk && risk.contract === 'NorthStarCapellaRecordedCosts/v1' &&
      JSON.stringify(risk.sourcePins) === JSON.stringify(review.pins) && risk.recordedAt === review.recordedAt &&
      risk.currency === review.currency && risk.simulated === review.simulated &&
      (decision ? risk.decision && risk.decision.id === decision.id && risk.decision.revision === decision.revision && risk.decision.digest === decision.digest : risk.decision === null);
    if (!matches) { paragraph('Cost comparison is unavailable. Refresh this estimate to try again.'); return; }
    paragraph(risk.message);
    if (risk.state === 'compared' || risk.state === 'shortfall') {
      var amount = risk.remainingAfterDirectCosts;
      var valid = typeof amount === 'string' && /^-?(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(amount) &&
        decision && decision.action === 'approve' && risk.priceBeforeTax === decision.priceBeforeTax &&
        decisionMoney(risk.priceBeforeTax, review.currency) !== 'Unavailable' && decisionMoney(risk.recordedDirectCosts, review.currency) !== 'Unavailable';
      if (!valid) { paragraph('Cost comparison is unavailable. Refresh this estimate to try again.'); return; }
      var list = document.createElement('dl');
      [['Reviewed price before tax', risk.priceBeforeTax], ['Recorded direct costs', risk.recordedDirectCosts],
        [risk.state === 'shortfall' ? 'Shortfall against recorded direct costs' : 'Remaining after recorded direct costs', amount.replace(/^-/, '')]].forEach(function (row) {
        var group = document.createElement('div'), term = document.createElement('dt'), detail = document.createElement('dd');
        term.textContent = row[0]; detail.textContent = decisionMoney(row[1], review.currency); group.appendChild(term); group.appendChild(detail); list.appendChild(group);
      }); root.appendChild(list);
    }
    paragraph(risk.limitation);
  }

  function refreshEstimateReview(focusReason) {
    var root = $('cdEstimateReview'), button = $('cdEstimateReviewRefresh');
    var selected = _currentData && _currentData.canonical;
    var generation = _openSequence, request = ++_reviewSequence;
    var restoreFocus = focusReason === 'adoption-saved' || focusReason === 'revision-selected' || focusReason === 'material-saved' || focusReason === 'decision-saved' || focusReason === 'review-refresh' || document.activeElement === button || $('cdEstimateDecision').contains(document.activeElement);
    _estimateReview = null; $('cdEstimateDecision').replaceChildren();
    $('cdCapellaReview').replaceChildren(); $('cdCapellaReview').hidden = true;
    root.replaceChildren(); root.textContent = 'Loading estimate review.'; root.setAttribute('aria-busy', 'true');
    button.disabled = true;
    function current() { return generation === _openSequence && request === _reviewSequence && _currentData && _currentData.canonical === selected && !_drawerEl.hidden; }
    function unavailable(message) { root.replaceChildren(); root.textContent = message; }
    if (!selected || !selected.ids || !selected.ids.estimate) {
      unavailable('No estimate is available for this customer.'); root.setAttribute('aria-busy', 'false'); return;
    }
    window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/' + encodeURIComponent(selected.ids.estimate) + '/review' + (_selectedEstimateRevision === null ? '' : '?revision=' + encodeURIComponent(_selectedEstimateRevision)), { cache: 'no-store' })
      .then(function(response) {
        if (!response.ok) { var error = new Error('review unavailable'); error.status = response.status; throw error; }
        return response.json();
      }).then(function(body) {
        if (!current()) return;
        var review = body && body.success && body.data;
        if (!reviewPinsMatch(review, selected)) { unavailable('The estimate has changed. Close this panel and reopen the customer to review it.'); return; }
        root.replaceChildren();
        function paragraph(text) { var node = document.createElement('p'); node.style.margin = '0 0 0.75rem'; node.textContent = text; root.appendChild(node); }
        renderRevisionSelector(review,root);
        if (review.simulated) paragraph('Demo example using fictional company and job information.');
        paragraph(review.approvalMessage);
        paragraph(review.basisMessage);
        var date = new Date(review.recordedAt);
        paragraph(Number.isFinite(date.getTime()) ? 'Estimate information recorded ' + date.toLocaleString() + '.' : 'The date of this estimate is unavailable.');
        var list = document.createElement('div'); list.className = 'drawer-pricing-category';
        (review.rows || []).forEach(function(row) {
          var rowNode = document.createElement('div'); rowNode.className = 'drawer-pricing-item';
          var term = document.createElement('span'), detail = document.createElement('span');
          rowNode.style.gap='0.75rem';term.style.minWidth='0';detail.style.whiteSpace='nowrap';detail.style.flexShrink='0';
          term.textContent = row.label;
          if (typeof row.amount === 'number' && Number.isFinite(row.amount)) {
            try { detail.textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: review.currency }).format(row.amount); }
            catch (_error) { detail.textContent = 'Currency unavailable'; }
          } else if (typeof row.amount === 'string') detail.textContent = decisionMoney(row.amount,review.currency);
          else detail.textContent = row.sourceState==='not_applicable'?'Not applicable':'Unavailable';
          rowNode.appendChild(term); rowNode.appendChild(detail); list.appendChild(rowNode);
        }); root.appendChild(list);
        renderMaterialReview(review, root);
        (review.missing || []).forEach(paragraph);
        if (_decisionDraft && _decisionDraft.basis !== decisionReviewBasis(review)) {
          _decisionDraft.confirmed = false; _decisionDraft.request = null; _decisionDraft.basisChanged = true;
          _decisionDraft.basis = decisionReviewBasis(review);
        }
        _estimateReview = review; renderEstimateDecision(review); renderCapellaReview(review);
      }).catch(function(error) {
        if (!current()) return;
        unavailable(error.status === 401 ? 'Sign in again to review this estimate.' : error.status === 403 ?
          'Estimate review is available to current owners and administrators.' : error.status === 404 ?
          'This estimate is no longer available. Reopen the customer to try again.' : 'Estimate review could not be loaded. Try refreshing it.');
      }).finally(function() { if (current()) { root.setAttribute('aria-busy', 'false'); button.disabled = false; if (restoreFocus) { if (focusReason === 'material-saved') { var material=$('cdMaterialReview');if(material){material.open=true;var action=material.querySelector('#cdMaterialPlan button');if(action)action.focus();else button.focus();} } else if (focusReason === 'decision-saved' || focusReason === 'adoption-saved') focusDecisionAction('approve'); else if(focusReason==='revision-selected'&&$('cdEstimateRevisionSelect'))$('cdEstimateRevisionSelect').focus(); else button.focus(); } } });
  }

  function populateDrawer(data) {
    var executionRecords = $('cdExecutionRecords');
    if (window.NorthStarExecutionLinks) window.NorthStarExecutionLinks.clear(executionRecords);
    executionRecords.replaceChildren();
    (data.canonicalRecords || []).forEach(function(record) {
      var ids = record && record.ids || {};
      var group = document.createElement('div');
      var title = document.createElement('h4');
      title.textContent = record && record.values && record.values.service && record.values.service.label || 'Recorded work';
      group.appendChild(title); executionRecords.appendChild(group);
      if (window.NorthStarExecutionLinks) window.NorthStarExecutionLinks.mount(group, {
        appointmentId:ids.appointment, graphId:ids.graph, customerId:ids.customer
      });
    });
    if (!executionRecords.children.length) executionRecords.textContent = 'No exact work records are available in this loaded customer view.';
    $('cdDrawerLoading').style.display = 'none';
    $('cdDrawerContent').style.display = '';
    $('cdDrawerTitle').textContent = data.name || 'Customer Details';
    _drawerEl.setAttribute('aria-busy', 'false');
    if (_sourceContext.source === 'leads') {
      $('cdContextSummary').textContent = 'Lead inquiry details, recorded work facts, and the actions available for this customer.';
      $('cdTranscriptHeading').textContent = 'Recorded Conversation';
    } else if (_sourceContext.source === 'communications') {
      $('cdContextSummary').textContent = 'Customer information and the complete prior communication history recorded for this customer.';
      $('cdTranscriptHeading').textContent = 'Selected Conversation';
    } else {
      $('cdContextSummary').textContent = 'Customer details, recorded work facts, and available actions.';
      $('cdTranscriptHeading').textContent = 'Call Transcript';
    }

    // Contact Information
    var missing = [];
    $('cdName').textContent = data.name || '\u2014';
    if (!data.name) missing.push('customer name');
    $('cdPhone').textContent = data.phone || '\u2014';
    if (!data.phone) missing.push('phone number');
    $('cdEmail').textContent = data.email || '\u2014';
    $('cdServiceAddress').textContent = data.serviceAddress || 'Service Address Not Recorded';
    $('cdServiceAddress').setAttribute('aria-label', data.serviceAddress ? 'Service Address: ' + data.serviceAddress : 'Service Address Not Recorded');
    var contactMethods = $('cdContactMethods'); contactMethods.replaceChildren(); contactMethods.hidden = true;
    $('cdBtnContact').setAttribute('aria-expanded', 'false');
    var contactCount = 0;
    function addContactMethod(label, value, href) {
      if (!value) return;
      var row = document.createElement('p'); var name = document.createElement('strong'); name.textContent = label + ': ';
      var method = document.createElement(href ? 'a' : 'span'); method.textContent = value;
      if (href) method.href = href;
      row.append(name, method); contactMethods.appendChild(row); contactCount++;
    }
    var phone = typeof data.phone === 'string' ? data.phone.trim() : '';
    var email = typeof data.email === 'string' ? data.email.trim() : '';
    addContactMethod('Phone', phone, /^[+\d\s().-]+$/.test(phone) && /\d/.test(phone) ? 'tel:' + phone.replace(/[^+\d]/g, '') : null);
    addContactMethod('Email', email, /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(email) ? 'mailto:' + encodeURIComponent(email) : null);
    var contactHint = document.createElement('p'); contactHint.className = 'drawer-contact-hint';
    contactHint.textContent = contactCount ? (window.location.pathname.indexOf('/demo') === 0 ? 'These are fictional demo contact details.' : 'Choose a method to open your phone or email app.') : 'No phone number or email address is recorded.';
    contactMethods.appendChild(contactHint);
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
    var work = workPresentation(data);
    renderWorkFacts('cdDescription', work.description);
    renderWorkFacts('cdWorkGates', work.gates);
    renderWorkFacts('cdWorkMaterials', work.materials);
    renderWorkFacts('cdWorkEquipment', work.equipment);
    renderWorkFacts('cdWorkScheduling', work.scheduling);

    renderWorkFacts('cdWorkRisk', work.risk);
    var sourceValues = data.intelligence || {}, sourceScope = sourceValues.service && sourceValues.service.scope || {};
    var neutral = [];
    if (sourceValues.callDurationSeconds == null) neutral.push('Call length not recorded.');
    if (sourceScope.timeZone) {
      var zoneLabel = 'Needs confirmation';
      try { zoneLabel = new Intl.DateTimeFormat('en-US', { timeZone:sourceScope.timeZone, timeZoneName:'longGeneric' }).formatToParts(new Date()).find(function(part) { return part.type === 'timeZoneName'; }).value; } catch (_zoneError) {}
      neutral.push('Work time zone: ' + zoneLabel + '.');
    }
    $('cdNeutralContext').textContent = neutral.join(' ');
    if (sourceValues.risk && sourceValues.risk.emergency) $('cdAttentionSection').appendChild($('cdWorkRisk'));
    else $('cdNeutralContext').parentElement.insertBefore($('cdWorkRisk'),$('cdNeutralContext'));
    $('cdChargeHeading').textContent = window.NorthStarDemoRuntime && window.NorthStarDemoRuntime.active ? 'Original charges · fictional example' : 'Original charge details';
    $('cdStage').textContent = stageLabel(data.stage);
    $('cdProb').textContent = data.closeProbability != null
      ? data.closeProbability + '%'
      : 'Not recorded';
    $('cdProbabilityRow').hidden = data.closeProbability == null;

    // POLARIS Intelligence
    var intel = generatePolarisIntel(data);
    $('cdPolSummary').textContent = intel.summary;
    $('cdDemoBadge').hidden = !(window.NorthStarDemoRuntime && window.NorthStarDemoRuntime.active);
    var originalRange = data.intelligence && data.intelligence.preliminaryRange;
    $('cdPolRange').textContent = originalRange && originalRange.low != null && originalRange.high != null ? 'Original range: ' + fmtCurrency(originalRange.low) + ' – ' + fmtCurrency(originalRange.high) : 'Original range not recorded';
    $('cdPolPrice').textContent = intel.price;
    $('cdPolConfidence').textContent = intel.confidenceLabel + ' (' + intel.confidencePct + ')';
    $('cdPolAction').textContent = intel.action;

    // Pricing Breakdown
    $('cdPricingBreakdown').innerHTML = renderPricingBreakdown(data.estimates);
    $('cdEstimateReviewRefresh').onclick = function () { refreshEstimateReview('review-refresh'); };
    refreshEstimateReview();

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
      reason.textContent = 'No customer or lead is available for these actions. Open or add the customer before continuing.';
    } else if (demo) {
      reason.textContent = 'Demo Schedule opens read-only Calendar. Ask Polaris keeps this record selected.';
    } else {
      reason.textContent = 'Ask Polaris keeps this record selected. Schedule opens Calendar for this customer.';
    }
  }

  function close() {
    _openSequence += 1;
    if (window.NorthStarExecutionLinks) window.NorthStarExecutionLinks.clear($('cdExecutionRecords'));
    if ($('cdExecutionRecords')) $('cdExecutionRecords').replaceChildren();
    if (_overlayEl) _overlayEl.classList.remove('open');
    if (_drawerEl) _drawerEl.classList.remove('open');
    if (_overlayEl) _overlayEl.hidden = true;
    if (_drawerEl) {
      _drawerEl.hidden = true;
      _drawerEl.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
    setBackgroundInert(false);
    _currentData = null; _estimateReview = null; _decisionDraft = null;
    _sourceContext = { source: 'customer', communicationId: null };
    if (_returnFocus && typeof document.contains === 'function' && document.contains(_returnFocus)) _returnFocus.focus();
    _returnFocus = null;
  }

  function selectTranscript(commId) {
    if (!commId || !_currentData) return;
    var transcript = _commIdToTranscript[commId];
    if (transcript) {
      $('cdTranscriptDisclosure').open = true;
      renderTranscript(transcript, _currentData.name);
    }
  }

  return {
    open: open,
    close: close,
    selectTranscript: selectTranscript
  };
})();
