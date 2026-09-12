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
    html += '      <details class="drawer-section" id="cdExecutionSection"><summary>Work Details</summary><div id="cdExecutionRecords"></div></details>';
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
    html += '            <section class="drawer-review-section" aria-label="Estimate review">';
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
    var description = document.createElement('p'); description.id = 'cdJobDescription'; description.className = 'drawer-job-description'; brand.after(description);
    var descriptionDetails = document.createElement('details'); descriptionDetails.id = 'cdJobDescriptionDetails'; descriptionDetails.className = 'drawer-job-description-details'; descriptionDetails.hidden = true;
    var descriptionSummary = document.createElement('summary'); descriptionSummary.textContent = 'Full Job Description'; var descriptionBody = document.createElement('p'); descriptionBody.id = 'cdFullJobDescription'; descriptionDetails.append(descriptionSummary,descriptionBody); description.after(descriptionDetails);
    var polarisStar = document.createElement('span'); polarisStar.className = 'polaris-inline-star'; polarisStar.setAttribute('aria-hidden', 'true'); polarisStar.textContent = '\u2726'; brand.prepend(polarisStar);
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
    analysis.after(priceDetails);
    panel.appendChild(basisDetails);
    var profileSection = $('cdProfileSection');
    var contactDetails = document.createElement('details'); contactDetails.className = 'drawer-section drawer-customer-background';
    var contactTitle = document.createElement('summary'); contactTitle.textContent = 'Customer History';
    contactDetails.append(contactTitle,profileSection);
    contactDetails.appendChild($('cdProbabilityRow'));
    panel.querySelector('.drawer-polaris-context').remove();
    var actionSection = $('cdBtnAskPolaris').closest('.drawer-section'); actionSection.classList.add('drawer-primary-actions');
    content.prepend(actionSection,polarisSection);
    polarisSection.after($('cdCapellaReview'),attention,nextAction,$('cdExecutionSection'),$('cdTranscriptDisclosure'),contactDetails);
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
    var disclosure = $('cdTranscriptDisclosureNote');
    if (!disclosure) { disclosure=document.createElement('p'); disclosure.id='cdTranscriptDisclosureNote'; $('cdTranscript').before(disclosure); }
    disclosure.hidden = !simulated;
    disclosure.textContent = 'Authored demo conversation. No live call or connected knowledge search took place.';
    if (simulated && /For this example|fictional business profile|does not approve a price or book the work|internal costs are incomplete/.test(typeof transcript==='string'?transcript:JSON.stringify(transcript))) disclosure.textContent='Earlier saved demo conversation. Simulate Lead creates a new example with updated dialogue. Reset Demo replaces this workspace and clears its changes.';

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
        if (id === 'cdDescription' && /^(work type|material|equipment|service area|fixture|system type|leak severity|finish|access|terrain|breaker behavior)$/i.test(text.slice(0,separator))) value.classList.add('drawer-fact-categorical');
        item.append(label,value);
      } else item.textContent = text;
      root.appendChild(item);
    });
  }

  function workPresentation(data) {
    var values = data.intelligence || {}, service = values.service || {}, scope = service.scope;
    function measured(value, unit) { return typeof value === 'number' && Number.isFinite(value) ? value + ' ' + unit : 'Not recorded'; }
    function cost(value) { return value == null ? 'Not recorded' : fmtCurrency(value); }
    var labels = { customerDistanceMiles:'Customer distance', equipmentReference:'Equipment', jobType:'Work type', laborHours:'Labor time', serviceRadiusMiles:'Service radius', serviceZone:'Service area', linearFeet:'Length', estimatedDurationHours:'Estimated duration', seer:'SEER', sqft:'Area', squareFeet:'Area' };
    var units = { customerDistanceMiles:'miles', serviceRadiusMiles:'miles', linearFeet:'ft', laborHours:'hours', estimatedDurationHours:'hours', sqft:'square feet', squareFeet:'square feet' };
    if (service.key === 'hvac') { labels.tonnage = 'Cooling capacity'; units.tonnage = 'tons'; }
    var scopeFacts = scope && typeof scope === 'object' && !Array.isArray(scope) ? Object.keys(scope).filter(function(key) { return !['timeZone','description','workDescription'].includes(key) && (!presentationFormat().isInternalKey(key) || key === 'equipmentReference'); }).map(function(key) {
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

  function jobDescription(data) {
    var service = data.intelligence && data.intelligence.service || {}, scope = service.scope;
    var recorded = typeof scope === 'string' ? scope : scope && (typeof scope.description === 'string' ? scope.description : typeof scope.workDescription === 'string' ? scope.workDescription : null);
    if (recorded && recorded.trim()) return recorded.trim();
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return 'No job description has been recorded.';
    var label = typeof service.label === 'string' && service.label.trim() ? service.label.trim() : 'Recorded work';
    var detail = service.key === 'hvac' ? scope.systemType : service.key === 'plumbing' ? scope.fixture : service.key === 'concrete' ? scope.finish : scope.material;
    var sentence = label;
    if (typeof detail === 'string' && detail.trim()) sentence += service.key === 'hvac' ? ' involving a ' + detail.trim() + ' system' : service.key === 'plumbing' ? ' for a ' + detail.trim() : service.key === 'concrete' ? ' with a ' + detail.trim() + ' finish' : ' using ' + detail.trim();
    var sentences = [sentence + '.'];
    if (typeof scope.symptoms === 'string' && scope.symptoms.trim()) sentences.push('Reported issue: ' + scope.symptoms.trim() + '.');
    var size = Number.isFinite(scope.linearFeet) ? 'Recorded length: ' + scope.linearFeet + ' ft.' : Number.isFinite(scope.squareFeet) ? 'Recorded area: ' + scope.squareFeet + ' square feet.' : Number.isFinite(scope.sqft) ? 'Recorded area: ' + scope.sqft + ' square feet.' : Number.isFinite(scope.squares) && service.key === 'roofing' ? 'Recorded roof area: ' + scope.squares + ' roofing squares.' : null;
    if (size) sentences.push(size);
    if (sentences.length === 1 && sentence === label) sentences.push('Review the recorded scope below before confirming the work.');
    return sentences.join(' ');
  }

  function renderJobDescription(data) {
    var full = jobDescription(data), limit = 240, long = full.length > limit;
    var excerpt = long ? full.slice(0,limit) : full;
    if (long) { var stop = excerpt.lastIndexOf(' '); if (stop > 120) excerpt = excerpt.slice(0,stop); excerpt += '\u2026'; }
    $('cdJobDescription').textContent = excerpt;
    $('cdJobDescriptionDetails').hidden = !long; $('cdJobDescriptionDetails').open = false;
    $('cdFullJobDescription').textContent = long ? full : '';
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

    _decisionDraft = null; _laborPlanDraft = null; _equipmentPlanDraft = null; _equipmentCostDraft=null; _materialPlanDraft = null; _adoptionDraft = null; _selectedEstimateRevision = null; _estimateReview = null;
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
    var label = document.createElement('label'), confirm = document.createElement('input'); label.className = 'drawer-decision-confirmation'; confirm.type = 'checkbox'; confirm.id = 'cdDecisionConfirm'; confirm.required = true; confirm.checked = draft.confirmed; confirm.onchange = function () { draft.confirmed = confirm.checked; draft.request = null; }; label.appendChild(confirm);
    var confirmationText = document.createElement('span'); confirmationText.textContent = draft.action === 'approve' ? ' I reviewed this recorded estimate, its missing information, the work scope and price. Approve these details for quote preparation only; nothing will be sent.' : ' Withdraw the current approval. Its history will remain, and these details will no longer be approved for quote preparation.'; label.appendChild(confirmationText); form.appendChild(label);
    var status = document.createElement('p'); status.id = 'cdDecisionStatus'; status.setAttribute('role', 'status'); status.tabIndex = -1; if (draft.basisChanged) status.textContent = 'The saved review changed. Check your entries and confirm again before saving.'; status.style.marginTop = '0.75rem'; form.appendChild(status);
    var actions = document.createElement('div'); actions.className = 'drawer-review-actions'; form.appendChild(actions);
    var save = document.createElement('button'); save.type = 'submit'; save.className = 'btn btn-secondary btn-sm'; save.textContent = draft.action === 'approve' ? 'Approve for quote preparation' : 'Confirm withdrawal'; actions.appendChild(save);
    var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-secondary btn-sm'; cancel.textContent = 'Cancel'; cancel.onclick = function () { _decisionDraft = null; renderEstimateDecision(_estimateReview); focusDecisionAction(draft.action); }; actions.appendChild(cancel);
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
      (p.revision ? review.originalRecordedAt === selected.snapshotCreatedAt && p.revision.number === review.selectedRevision && ['estimate-material-adoption-v1','estimate-material-adoption-v2','estimate-material-adoption-v3','estimate-material-adoption-v4','estimate-cost-adoption-v1','estimate-cost-adoption-v2'].indexOf(p.revision.calculationVersion)>=0 : review.recordedAt === selected.snapshotCreatedAt);
  }

  var _materialPlanDraft = null, _adoptionDraft = null, _selectedEstimateRevision = null;
  function materialPlanBasis(review) {
    var plan=review.materialPlans;
    return JSON.stringify({pins:review.pins,decision:plan&&plan.decisionBasis,current:plan&&plan.current&&{id:plan.current.id,revision:plan.current.revision,digest:plan.current.digest},allowed:plan&&plan.canMutate,currency:review.currency});
  }
  function materialLines(plan) {
    if (!plan || !plan.inputs) return [];
    return ['estimate-material-plan-v2','estimate-material-plan-v3','estimate-material-plan-v4'].indexOf(plan.calculationVersion)>=0 ? plan.inputs.lines : [plan.inputs];
  }
  function materialResult(result, target) {
    function text(label, value) { var row=document.createElement('p');row.textContent=label+': '+value;row.style.overflowWrap='anywhere';target.appendChild(row); }
    if (result.lines) {
      result.lines.forEach(function(line,index){var section=document.createElement('section');var title=document.createElement('h4');title.textContent='Material '+(index+1)+' — '+line.material;section.appendChild(title);materialResult(line,section);target.appendChild(section);});
      text('Plan Total',decisionMoney(result.total,result.currency));if(result.sourceAssessment)materialSourceAssessment(result.sourceAssessment,target);if(result.availabilityAssessment)materialAvailabilityAssessment(result.availabilityAssessment,target,result.lines);return;
    }
    text('Required Quantity',result.quantity+' '+result.unitLabel);
    text('Extra For Waste',result.additionalQuantity+' '+result.unitLabel);
    text('Planned Quantity',result.plannedQuantity+' '+result.unitLabel);
    text('Price Per Unit',decisionMoney(result.unitPrice,result.currency));
    text('Material Cost',decisionMoney(result.total,result.currency));
    text('Rounding',result.rounding);
  }
  function sameSourceFlags(a,b){return !!a&&!!b&&a.lines.length===b.lines.length&&a.lines.every(function(row,i){var other=b.lines[i];return row.lineId===other.lineId&&row.evidenceDigest===other.evidenceDigest&&JSON.stringify(row.flags)===JSON.stringify(other.flags);});}
  function materialSourceAssessment(assessment,target) {
    var labels={date_missing:'Date Not Recorded',end_date_missing:'No End Date Recorded',not_effective:'Not Effective Yet',expired:'Past Recorded End Date',place_unknown:'Place Not Recorded',service_mismatch:'Different Service',applicability_unconfirmed:'Confirm Job Applicability',conflict:'Conflicting Prices'};
    var p=document.createElement('p');p.textContent='Source Review: '+assessment.asOfDate+' (UTC)';target.appendChild(p);
    assessment.lines.forEach(function(row,index){var el=document.createElement('p');el.textContent='Material '+(index+1)+': '+(row.flags.length?row.flags.map(function(f){return labels[f]||'Review Source';}).join(' · '):'Within Recorded Dates — Human-Recorded');target.appendChild(el);});
  }
  function materialSource(line,target) {
    var e=line.evidence,section=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Cost Source';section.appendChild(summary);target.appendChild(section);
    function row(label,value){if(value===null||value===undefined||value==='')return;var p=document.createElement('p');p.style.overflowWrap='anywhere';p.textContent=label+': '+value;section.appendChild(p);}
    if(!e){row('Recorded Note',line.sourceNote);row('Price Date',line.priceDate||'Not Recorded');row('Source','Human-Recorded; Not Independently Verified');return;}
    row('Type',{my_estimate:'My Cost Estimate',company_record:'Company Record',supplier_quote:'Supplier Quote',published_reference:'Published Reference'}[e.kind]);row('Recorded By','A Company Reviewer; Not Independently Verified');row('Source Name',e.issuer);row('Reference',e.reference);row('Effective Date',e.effectiveOn||'Not Recorded');row('Valid Through',e.validThrough||'No End Date Recorded');row('Area',[e.countryCode?new Intl.DisplayNames(['en'],{type:'region'}).of(e.countryCode):null,e.region,e.locality].filter(Boolean).join(', ')||'Not Recorded');row('Material Specification',e.materialSpecification);row('Review Note',e.exceptionReason);row('Source Note',line.sourceNote);
  }
  function availabilityFailure(message,inputs){
    var guidance={
      'The checked date cannot be in the future.':'Availability: choose a Checked On date no later than today, then calculate again.',
      'Enter a valid availability date or leave it unknown.':'Availability: enter a valid date or leave it blank, then calculate again.',
      'The availability end date must follow the checked date.':'Availability: Valid Through must be on or after Checked On. Correct the dates and calculate again.',
      'Explain why you are using expired availability evidence.':'Availability: add a reason for using expired evidence, or update the evidence, then calculate again.',
      'These materials refer to the same available supply. Combine them or record distinct sources.':'Availability: these lines refer to the same supply. Combine the quantities into one material line or record genuinely distinct sources, then calculate again.'
    };if(inputs&&inputs.availabilityAssessment&&inputs.availabilityAssessment.lines.some(function(row,i){return row.flags.indexOf('expired')>=0&&!inputs.lines[i].availability.exceptionReason;}))return guidance['Explain why you are using expired availability evidence.'];return Object.prototype.hasOwnProperty.call(guidance,message)?guidance[message]:'Check each material, quantity and price source, then calculate again.';
  }
  function unknownAvailability(){return {kind:'unknown',issuer:null,reference:null,observedOn:null,validThrough:null,location:null,availableQuantity:null,statedUnit:null,leadTimeDays:null,appliesToReviewedJob:false,exceptionReason:null};}
  function materialAvailabilityAssessment(a,target,lines){
    var section=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Reported Availability';section.appendChild(summary);target.appendChild(section);
    var note=document.createElement('p');note.textContent='Reviewed '+a.asOfDate+' (UTC). Reported quantities are not reserved or independently verified.';section.appendChild(note);
    a.lines.forEach(function(row,i){var p=document.createElement('p');p.textContent='Material '+(i+1)+': '+({unknown:'Current Availability Unknown',reported_shortage:'Reported Shortage',reported_sufficient:'Reported Quantity Covers This Plan'}[row.currentStatus]);section.appendChild(p);if(row.reportedQuantity!==null){var q=document.createElement('p');var unit=lines&&lines[i]&&lines[i].unitLabel||'Units Unknown';q.textContent='Required: '+row.requiredQuantity+' '+unit+' · Reported: '+row.reportedQuantity+' '+unit+' · Shortage: '+row.shortage+' '+unit;section.appendChild(q);}if(row.flags.length){var f=document.createElement('p');var labels={unknown:'No Availability Evidence',date_missing:'Checked Date Unknown',end_date_missing:'End Date Unknown',expired:'Expired Evidence',place_unknown:'Location Unknown',quantity_unknown:'Quantity Unknown',applicability_unconfirmed:'Confirm Job Applicability'};f.textContent=row.flags.map(function(k){return labels[k]||'Review Availability';}).join(' · ');section.appendChild(f);}});
  }
  function materialAvailabilityDetails(line,target){var section=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Availability Evidence';section.appendChild(summary);target.appendChild(section);function row(label,value){var p=document.createElement('p');p.style.overflowWrap='anywhere';p.textContent=label+': '+value;section.appendChild(p);}var e=line.availability;if(!e||e.kind==='unknown')row('Availability','Unknown');else{row('Source',{my_observation:'My Observation',company_record:'Company Record',supplier_statement:'Supplier Statement'}[e.kind]);if(e.kind==='my_observation'&&!e.reference)row('Observation Scope','This observation is for this material line, not a company-wide stock total.');if(e.issuer)row('Source Name',e.issuer);if(e.reference)row('Reference',e.reference);row('Checked On',e.observedOn||'Unknown');row('Valid Through',e.validThrough||'Unknown');row('Location',e.location||'Unknown');row('Reported Quantity',e.availableQuantity===null?'Unknown':e.availableQuantity+' '+({ea:'Items',ft:'Feet',m:'Metres',ft2:'Square Feet',m2:'Square Metres',m3:'Cubic Metres',ft3:'Cubic Feet',yd3:'Cubic Yards',kg:'Kilograms',lb:'Pounds',l:'Litres',gal:'US Liquid Gallons'}[line.unit]));row('Reported Lead Time',e.leadTimeDays===null?'Unknown':e.leadTimeDays+' Calendar Days After Ordering');if(e.exceptionReason)row('Review Note',e.exceptionReason);}if(line.replacement)row('Alternative Selection',line.replacement.reason+' — Suitability Reviewed By The Company');}
  var _equipmentCostDraft=null;
  function renderEquipmentCosts(review,parent){
    var plans=review.equipmentCostPlans,equipment=review.equipmentPlans&&review.equipmentPlans.current,root=document.createElement('details');root.id='cdEquipmentCosts';root.dataset.equipmentDisclosure='costs';parent.appendChild(root);
    function el(tag,text,target){var e=document.createElement(tag);if(text)e.textContent=text;(target||root).appendChild(e);return e;}
    function p(text,target){return el('p',text,target);}
    function button(text,fn,target){var b=el('button',text,target);b.type='button';b.className='btn btn-secondary';b.onclick=fn;return b;}
    el('summary','Equipment Costs');
    if(!plans||plans.contract!=='estimate-equipment-cost-plan-v1'||JSON.stringify(plans.sourcePins)!==JSON.stringify(review.pins)||plans.simulated!==review.simulated){p('Equipment costs are unavailable. Refresh this estimate.');return;}
    var current=plans.current;
    function show(result,target){p((result.complete?'Declared Equipment Cost: ':'Known Equipment Subtotal: ')+decisionMoney(result.complete?result.total:result.knownCostSubtotal,result.currency),target);result.lines.forEach(function(l,i){p('Equipment '+(i+1)+': '+decisionMoney(l.total===null?l.knownCostSubtotal:l.total,result.currency)+(l.complete?'':' — Incomplete'),target);if(l.missing.length)p('Still Needed: '+l.missing.join(', '),target);l.outsideCoverage.forEach(function(c){p((c.kind==='operator'?'Operator Labor':'Travel')+': confirm where this mixed-charge share is covered.',target);});});}
    function showBasis(plan,target,title){
      var detail=el('details',null,target);el('summary',title||'Recorded Cost Basis',detail);
      function chargeBasis(label,c,box){if(!c)return;p(label+': '+decisionMoney(c.amount,plan.currency)+(c.scope==='mixed'?' — Mixed Charge':' — Equipment Only'),box);if(c.scope==='mixed'){p('Equipment Share: '+decisionMoney(c.split.equipment,plan.currency)+' · Operator: '+decisionMoney(c.split.operator,plan.currency)+' · Travel: '+decisionMoney(c.split.travel,plan.currency)+' · Overhead: '+decisionMoney(c.split.overhead,plan.currency),box);['operator','travel'].forEach(function(k){var coverage=c.split[k+'Coverage'];p((k==='operator'?'Operator':'Travel')+' Coverage: '+(coverage.status==='covered'?'Declared Covered In The Reviewed '+(k==='operator'?'Labor':'Travel')+' Basis':coverage.status==='unaccounted'?'Not Accounted For':'Unknown'),box);if(coverage.note)p(coverage.note,box);});p('Only the equipment share enters this equipment total. Overhead is not included in direct costs.',box);}}
      var labels={capital_recovery:'Capital Recovery',debt_service:'Debt Service',interest:'Interest',insurance:'Equipment Insurance',maintenance:'Maintenance Or Reserve',operating:'Equipment Operating Expenses',fuel_energy:'Fuel Or Energy',consumables:'Consumables'};
      plan.inputs.lines.forEach(function(l,i){var box=el('div',null,detail);el('h4','Equipment '+(i+1)+' — '+({economic_recovery:'Economic Recovery',financing_cash:'Financing Cash Allocation',rental:'Rental Billing',not_applicable:'Not Applicable'}[l.method]),box);if(l.method==='not_applicable'){p(l.notApplicableReason,box);return;}p('Planned Equipment Use: '+(l.plannedHours===null?'Unknown':l.plannedHours+' Hours'),box);
        if(l.rental){var unit={hour:'Hour',day:'Day',week:'Week',month:'Month',job:'Job'}[l.rental.unit];chargeBasis('Rental Cost Per '+unit,l.rental.charge,box);p('Billed Quantity: '+(l.rental.quantity===null?'Unknown':l.rental.quantity)+' '+unit+' · Stated Minimum: '+(l.rental.minimumQuantity===null?'Unknown':l.rental.minimumQuantity+' '+unit),box);}
        if(l.allocation){chargeBasis('Cost Pool Per '+(l.allocation.period==='month'?'Month':'Year'),l.allocation.pool,box);p('Usable Equipment Hours In That Period: '+(l.allocation.usableHours===null?'Unknown':l.allocation.usableHours),box);p('Pool Includes: '+l.allocation.includedCategories.map(function(c){return labels[c]||'Equipment Cost';}).join(' · '),box);l.allocation.additionalCosts.forEach(function(c){chargeBasis(c.label+' — '+labels[c.category],c.charge,box);});}
        if(l.operating)(l.operating.mode==='all_in'?[['All-In Operating Cost',l.operating.allIn]]:[['Fuel Or Energy',l.operating.fuelEnergy],['Consumables',l.operating.consumables],['Maintenance',l.operating.maintenance]]).forEach(function(row){if(row[1].status==='known')chargeBasis(row[0]+' Per Equipment Hour',row[1].rate,box);else p(row[0]+': '+(row[1].status==='not_applicable'?'Not Applicable Or Already Included':'Unknown'),box);});
        l.fees.forEach(function(f){p(f.label+': '+decisionMoney(f.amount,plan.currency)+' Equipment-Only Job Fee',box);});var src=l.source;p('Source: '+({my_estimate:'My Estimate',company_reference:'Company Reference',published_reference:'Quoted Or Published Reference'}[src.kind])+' — Human-Recorded',box);if(src.issuer)p('Source Name: '+src.issuer,box);if(src.reference)p('Reference: '+src.reference,box);p('Effective Date: '+(src.effectiveOn||'Not Recorded')+' · End Date: '+(src.endsOn||'Not Recorded'),box);p('Applicable Area: '+(src.geography||'Not Recorded'),box);if(src.note)p(src.note,box);
      });
      var current=plan.currentSourceAssessment;if(current){var names={date_unknown:'Date Not Recorded',freshness_unknown:'Freshness Unknown',not_yet_effective:'Future Source Date',expired:'Source End Date Passed',applicability_unknown:'Applicable Area Not Recorded',rental_minimum_unknown:'Rental Minimum Not Recorded'};current.cautions.forEach(function(c){var i=plan.inputs.lines.findIndex(function(l){return l.lineId===c.lineId;});p('Equipment '+(i+1)+' — '+c.codes.map(function(code){return names[code]||'Source Needs Review';}).join(' · '),detail);});}
    }
    if(current&&current.action==='save'){show(current.result,root);if(current.id!==review.adoptedEquipmentCostPlan?.id)showBasis(current,root);if(!current.sourceBasisCurrent)p('These costs were saved for an earlier estimate. Review them again before applying a new change.');}
    else p(current?'The equipment cost plan was withdrawn. Saved history remains available.':'No equipment costs have been saved.');
    if(review.adoptedEquipmentCostPlan){p('Included In This Estimate: '+decisionMoney(review.adoptedEquipmentCostPlan.result.total,review.currency)+'. Editing the plan does not change these included costs.');showBasis(review.adoptedEquipmentCostPlan,root,'Included Equipment Cost Basis');if(review.financialCosts.changedEquipmentCoverage&&review.financialCosts.changedEquipmentCoverage.length)p('The included equipment plan refers to an earlier labor or travel review. Review its mixed-cost coverage again before relying on a combined total.');}
    if(plans.history.length){var history=el('details');history.dataset.equipmentDisclosure='cost-history';el('summary','Equipment Cost History',history);plans.history.forEach(function(e){var entry=el('details',null,history);el('summary',(e.action==='save'?'Saved':'Withdrawn')+' — '+new Date(e.createdAt).toLocaleString(),entry);p(e.actorName+' — '+e.reason,entry);if(e.result){show(e.result,entry);showBasis(e,entry);}});}
    if(!plans.canMutate){p(plans.mutationsPaused?'New equipment costs are paused. Saved history remains available.':'Select the current estimate to review equipment costs.');return;}
    var canSaveCosts=!!equipment&&equipment.action==='save'&&!equipment.currentSourcesChanged;
    if(!equipment||equipment.action!=='save')p('Save an Equipment Plan before entering new costs.'+(current&&current.action==='save'?' Existing costs can still be withdrawn.':''));
    else if(equipment.currentSourcesChanged)p('Review the changed equipment sources before saving new costs.'+(current&&current.action==='save'?' Existing costs can still be withdrawn.':''));
    var basis=JSON.stringify([review.pins,plans.decisionBasis,current&&current.digest,equipment&&equipment.digest,review.equipmentOutsideBasis]);
    function charge(){return{amount:null,scope:'equipment_only',split:null};}
    function rate(){return{status:'unknown',rate:null};}
    function emptyLine(l){return{lineId:l.lineId,access:l.accessBasis,method:'economic_recovery',notApplicableReason:null,plannedHours:null,rental:null,allocation:{period:'year',usableHours:null,pool:charge(),includedCategories:['capital_recovery'],additionalCosts:[]},operating:{mode:'all_in',allIn:rate(),fuelEnergy:null,consumables:null,maintenance:null},fees:[],source:{kind:'my_estimate',issuer:'',reference:'',note:'',effectiveOn:null,endsOn:null,geography:''}};}
    function redraw(focusId){var open=root.open,nested={};root.querySelectorAll('details[data-cost-section]').forEach(function(d){nested[d.dataset.costSection]=d.open;});root.remove();renderEquipmentCosts(review,parent);var mounted=document.getElementById('cdEquipmentCosts');if(mounted){mounted.open=open||!!_equipmentCostDraft;mounted.querySelectorAll('details[data-cost-section]').forEach(function(d){if(Object.prototype.hasOwnProperty.call(nested,d.dataset.costSection))d.open=nested[d.dataset.costSection];});}var focus=focusId&&document.getElementById(focusId);if(focus){for(var ancestor=focus.parentElement;ancestor&&ancestor!==mounted;ancestor=ancestor.parentElement)if(ancestor.tagName==='DETAILS')ancestor.open=true;focus.focus();}}
    function start(action){if(action==='withdraw'){_equipmentCostDraft={estimateId:review.pins.estimateId,basis:basis,action:action,inputs:null,reason:'',explanation:'',confirmed:false,result:null,assessment:null,request:null};redraw('cdCostReason');return;}if(!canSaveCosts)return;var old=current&&current.action==='save'&&current.inputs;var lines=equipment.inputs.lines.map(function(l){var prior=old&&old.lines.find(function(c){return c.lineId===l.lineId;});return prior?Object.assign(JSON.parse(JSON.stringify(prior)),{access:l.accessBasis}):emptyLine(l);});_equipmentCostDraft={estimateId:review.pins.estimateId,basis:basis,action:action,inputs:{serviceKey:equipment.inputs.serviceKey,equipmentBasis:{planId:equipment.id,revision:equipment.revision,digest:equipment.digest,sourcePins:equipment.sourcePins},lines:lines,assessment:null},reason:'',explanation:'',confirmed:false,result:null,assessment:null,request:null};redraw(action==='save'?'cdCostMethod-0':'cdCostReason');}
    if(!_equipmentCostDraft){var controls=el('div');controls.style.cssText='display:flex;flex-wrap:wrap;gap:.75rem;margin:.75rem 0;';if(canSaveCosts)button(current&&current.action==='save'?'Revise Equipment Costs':'Plan Equipment Costs',function(){start('save');},controls).id='cdEquipmentCostStart';if(current&&current.action==='save')button('Withdraw Equipment Costs',function(){start('withdraw');},controls).id='cdEquipmentCostWithdraw';return;}
    var draft=_equipmentCostDraft;if(draft.action==='save'&&!canSaveCosts){_equipmentCostDraft=null;redraw('cdEquipmentCostWithdraw');return;}if(draft.estimateId!==review.pins.estimateId){_equipmentCostDraft=null;redraw();return;}
    if(draft.basis!==basis){draft.basis=basis;draft.confirmed=false;draft.result=null;draft.assessment=null;draft.request=null;draft.changed=true;}
    root.open=true;var form=el('form');form.onsubmit=function(e){e.preventDefault();};
    function invalidate(){draft.result=null;draft.assessment=null;draft.confirmed=false;draft.request=null;if(draft.inputs)draft.inputs.assessment=null;if(confirm)confirm.checked=false;if(results)results.replaceChildren();}
    function field(target,label,id,value,fn,options,type){var wrap=el('label',label,target);wrap.style.cssText='display:flex;flex-direction:column;gap:.35rem;margin:.65rem 0;';var input=el(options?'select':'input',null,wrap);input.id=id;input.style.cssText='width:100%;box-sizing:border-box;padding:.65rem;color:#172033;background:white;color-scheme:light;font:inherit;border:1px solid #9ca3af;border-radius:.35rem;';if(options)options.forEach(function(o){el('option',o[1],input).value=o[0];});else input.type=type||'text';input.value=value===null?'':value;input.onchange=function(){invalidate();fn(input.value);};if(!options)input.oninput=input.onchange;return input;}
    function section(target,name,key){var d=el('details',null,target);d.dataset.costSection=key;el('summary',name,d);return d;}
    function money(target,label,id,value,fn){return field(target,label+' ('+review.currency+')',id,value,function(v){fn(v===''?null:v);});}
    function chargeFields(target,c,id,label){
      money(target,label,id+'-amount',c.amount,function(v){c.amount=v;});field(target,'Charge Includes',id+'-scope',c.scope,function(v){c.scope=v;c.split=v==='mixed'?{equipment:null,operator:null,travel:null,overhead:null,operatorCoverage:{status:'unknown',basis:null,note:''},travelCoverage:{status:'unknown',basis:null,note:''}}:null;redraw(id+'-scope');},[['equipment_only','Equipment Only'],['mixed','Equipment And Other Costs']]);
      if(c.scope==='mixed'){p('Split the same quoted amount. Only the equipment share enters these costs. Company overhead remains excluded.',target);['equipment','operator','travel','overhead'].forEach(function(k){money(target,{equipment:'Equipment Share',operator:'Operator Labor Share',travel:'Travel Share',overhead:'Company Overhead Share'}[k],id+'-'+k,c.split[k],function(v){c.split[k]=v;});});['operator','travel'].forEach(function(k){var coverage=c.split[k+'Coverage'];field(target,(k==='operator'?'Operator Labor':'Travel')+' Coverage',id+'-'+k+'-coverage',coverage.status,function(v){coverage.status=v;coverage.basis=v==='covered'?JSON.parse(JSON.stringify(review.equipmentOutsideBasis[k])):null;redraw(id+'-'+k+'-coverage');},[['unknown','Unknown'],['unaccounted','Not Yet Accounted For'],['covered','Covered In The Current Reviewed Costs']]);if(coverage.status==='covered')field(target,'Explain Where This Share Is Covered',id+'-'+k+'-note',coverage.note,function(v){coverage.note=v;}).required=true;});}
    }
    var categories=[['capital_recovery','Capital Recovery'],['debt_service','Debt Service'],['interest','Interest'],['insurance','Equipment Insurance'],['maintenance','Maintenance Or Reserve'],['operating','Equipment Operating Expenses'],['fuel_energy','Fuel Or Energy'],['consumables','Consumables']];
    if(draft.action==='save')draft.inputs.lines.forEach(function(l,i){var box=el('fieldset',null,form);box.style.cssText='min-width:0;margin:1rem 0;padding:.75rem;border:1px solid var(--border-color,#9ca3af);border-radius:.5rem;';el('legend',equipment.inputs.lines[i].task||'Equipment '+(i+1),box);
      field(box,'Cost Method','cdCostMethod-'+i,l.method,function(v){l.method=v;l.rental=null;l.allocation=null;l.notApplicableReason=null;l.fees=[];l.plannedHours=null;l.operating={mode:'all_in',allIn:rate(),fuelEnergy:null,consumables:null,maintenance:null};if(v==='rental')l.rental={unit:'day',quantity:null,minimumQuantity:null,charge:charge()};else if(v==='not_applicable'){l.notApplicableReason='';l.operating=null;}else l.allocation={period:'year',usableHours:null,pool:charge(),includedCategories:[v==='economic_recovery'?'capital_recovery':'debt_service'],additionalCosts:[]};redraw('cdCostMethod-'+i);},[['economic_recovery','Economic Recovery'],['financing_cash','Financing Cash Allocation'],['rental','Rental Billing'],['not_applicable','Not Applicable']]);
      if(l.method==='not_applicable'){field(box,'Why No Job Cost Applies','cdCostNotApplicable-'+i,l.notApplicableReason,function(v){l.notApplicableReason=v;}).required=true;return;}
      field(box,'Planned Equipment Use (Hours)','cdCostHours-'+i,l.plannedHours,function(v){l.plannedHours=v||null;});
      if(l.rental){field(box,'Rental Billing Unit','cdCostUnit-'+i,l.rental.unit,function(v){l.rental.unit=v;l.rental.quantity=v==='job'?'1':null;l.rental.minimumQuantity=null;l.rental.charge=charge();redraw('cdCostUnit-'+i);},[['hour','Hour'],['day','Day'],['week','Week'],['month','Month'],['job','Job']]);field(box,'Billed Quantity','cdCostQuantity-'+i,l.rental.quantity,function(v){l.rental.quantity=v||null;});field(box,'Stated Minimum Quantity (Blank If Unknown)','cdCostMinimum-'+i,l.rental.minimumQuantity,function(v){l.rental.minimumQuantity=v||null;});chargeFields(box,l.rental.charge,'cdCostRental-'+i,'Quoted Cost Per Billing Unit');}
      if(l.allocation){var a=l.allocation;field(box,'Allocation Period','cdCostPeriod-'+i,a.period,function(v){a.period=v;a.usableHours=null;a.pool=charge();a.additionalCosts=[];redraw('cdCostPeriod-'+i);},[['month','Month'],['year','Year']]);field(box,'Usable Equipment Hours In This '+(a.period==='month'?'Month':'Year'),'cdCostUsable-'+i,a.usableHours,function(v){a.usableHours=v||null;});chargeFields(box,a.pool,'cdCostPool-'+i,'Equipment Cost Pool Per '+(a.period==='month'?'Month':'Year'));var coverage=section(box,'Pool Coverage And Separate Costs','pool-'+l.lineId);p('Include each cost once. Equipment Operating Expenses includes fuel or energy, consumables and maintenance; do not charge them separately. Do not combine debt principal with economic recovery.',coverage);categories.filter(function(c){return c[0]!== (l.method==='economic_recovery'?'debt_service':'capital_recovery');}).forEach(function(c){var label=el('label',null,coverage);label.className='drawer-decision-confirmation';var check=el('input',null,label);check.type='checkbox';check.style.minHeight='0';check.checked=a.includedCategories.indexOf(c[0])>=0;check.disabled=c[0]===(l.method==='economic_recovery'?'capital_recovery':'debt_service');el('span',c[1]+' Included In The Pool',label);check.onchange=function(){invalidate();a.includedCategories=check.checked?a.includedCategories.concat([c[0]]):a.includedCategories.filter(function(k){return k!==c[0];});};});a.additionalCosts.forEach(function(c,j){var id='cdCostAdditional-'+i+'-'+j;field(coverage,'Separate Period Cost Category',id+'-category',c.category,function(v){c.category=v;},categories);field(coverage,'Cost Name',id+'-label',c.label,function(v){c.label=v;}).required=true;chargeFields(coverage,c.charge,id,'Separate Cost Per '+(a.period==='month'?'Month':'Year'));button('Remove Separate Cost',function(){a.additionalCosts.splice(j,1);invalidate();redraw('cdCostPeriod-'+i);},coverage);});if(a.additionalCosts.length<4)button('Add Separate Period Cost',function(){a.additionalCosts.push({category:'insurance',label:'',charge:charge()});invalidate();redraw('cdCostAdditional-'+i+'-'+(a.additionalCosts.length-1)+'-label');},coverage);}
      var op=section(box,'Operating Costs','operating-'+l.lineId);field(op,'Operating Cost Method','cdCostOperating-'+i,l.operating.mode,function(v){l.operating={mode:v,allIn:v==='all_in'?rate():null,fuelEnergy:v==='separate'?rate():null,consumables:v==='separate'?rate():null,maintenance:v==='separate'?rate():null};redraw('cdCostOperating-'+i);},[['all_in','All-In Operating Rate'],['separate','Separate Operating Rates']]);(l.operating.mode==='all_in'?['allIn']:['fuelEnergy','consumables','maintenance']).forEach(function(k){var r=l.operating[k],label={allIn:'All-In Operating Cost',fuelEnergy:'Fuel Or Energy',consumables:'Consumables',maintenance:'Maintenance'}[k],id='cdCostOperating-'+i+'-'+k;field(op,label,id,r.status,function(v){r.status=v;r.rate=v==='known'?charge():null;redraw(id);},[['unknown','Unknown'],['not_applicable','Not Applicable Or Already Included'],['known','Separate Known Rate']]);if(r.status==='known')chargeFields(op,r.rate,id,label+' Per Equipment Hour');});
      var fees=section(box,'Equipment-Only Job Fees','fees-'+l.lineId);p('Nonrefundable equipment-only fees. Exclude operator labor, travel, tax and refundable deposits.',fees);l.fees.forEach(function(f,j){var id='cdCostFee-'+i+'-'+j;field(fees,'Fee Name',id+'-label',f.label,function(v){f.label=v;}).required=true;field(fees,'Fee Category',id+'-category',f.category,function(v){f.category=v;},[['setup','Equipment Setup'],['inspection','Equipment Inspection'],['cleaning','Equipment Cleaning'],['other_equipment','Other Equipment Fee']]);money(fees,'Job Fee',id+'-amount',f.amount,function(v){f.amount=v;});button('Remove Job Fee',function(){l.fees.splice(j,1);invalidate();redraw('cdCostMethod-'+i);},fees);});if(l.fees.length<4)button('Add Equipment Fee',function(){l.fees.push({category:'setup',label:'',amount:null});invalidate();redraw('cdCostFee-'+i+'-'+(l.fees.length-1)+'-label');},fees);
      var s=section(box,'Cost Source','source-'+l.lineId),src=l.source;field(s,'Source Type','cdCostSource-'+i,src.kind,function(v){src.kind=v;},[['my_estimate','My Estimate'],['company_reference','Company Reference'],['published_reference','Quoted Or Published Reference']]);p('Human-recorded costs; NorthStar has not verified ownership or supplier pricing.',s);field(s,'Source Name','cdCostIssuer-'+i,src.issuer,function(v){src.issuer=v;});field(s,'Reference','cdCostReference-'+i,src.reference,function(v){src.reference=v;});field(s,'Assumptions','cdCostNote-'+i,src.note,function(v){src.note=v;});field(s,'Applicable Area','cdCostArea-'+i,src.geography,function(v){src.geography=v;});field(s,'Effective Date (Optional)','cdCostEffective-'+i,src.effectiveOn,function(v){src.effectiveOn=v||null;},null,'date');field(s,'End Date (Optional)','cdCostEnd-'+i,src.endsOn,function(v){src.endsOn=v||null;},null,'date');
    });
    field(form,'Reason For This Plan','cdCostReason',draft.reason,function(v){draft.reason=v;}).required=true;
    var results=el('div',null,form);results.id='cdCostResult';if(draft.result)show(draft.result,results);
    var explanation=field(form,'Source Assumptions To Confirm','cdCostExplanation',draft.explanation,function(v){draft.explanation=v;});explanation.oninput=explanation.onchange=function(){draft.explanation=explanation.value;draft.confirmed=false;draft.request=null;if(confirm)confirm.checked=false;};
    var label=el('label',null,form);label.className='drawer-decision-confirmation';var confirm=el('input',null,label);confirm.type='checkbox';confirm.id='cdCostConfirm';confirm.style.cssText='flex:0 0 auto;margin-top:.25rem;width:1rem;height:1rem;min-height:0;padding:0;';confirm.checked=draft.confirmed;el('span',draft.action==='save'?'I reviewed the equipment basis, costs, exclusions and source limitations. Save this plan without changing the estimate or customer price.':'Withdraw this equipment cost plan and retain its saved history.',label);confirm.onchange=function(){draft.confirmed=confirm.checked;draft.request=null;};
    var status=p(draft.changed?'The estimate or equipment review changed. Calculate again and confirm.':'',form);status.id='cdCostStatus';status.setAttribute('role','status');status.tabIndex=-1;
    function body(){if(draft.inputs&&draft.assessment)draft.inputs.assessment=Object.assign({},draft.assessment,{acknowledged:draft.confirmed,explanation:draft.explanation});return{action:draft.action,expectedRevision:current?current.revision:0,expectedDigest:current?current.digest:'none',sourcePins:review.pins,expectedDecisionRevision:plans.decisionBasis.revision,expectedDecisionDigest:plans.decisionBasis.digest,inputs:draft.action==='save'?draft.inputs:null,currency:review.currency,reason:draft.reason,confirmed:draft.confirmed,confirmationVersion:'estimate-equipment-cost-plan-v1'};}
    function send(preview){if(!form.reportValidity()||!reviewPinsMatch(review,_currentData&&_currentData.canonical))return;if(!preview&&(!draft.confirmed||draft.action==='save'&&!draft.result)){status.textContent=draft.action==='withdraw'?'Review the withdrawal and select the confirmation checkbox before withdrawing these costs.':'Calculate the equipment costs and confirm the review before saving.';status.focus();return;}var generation=_openSequence,attempt=preview?{body:body()}:draft.request||(draft.request={body:JSON.parse(JSON.stringify(body())),key:crypto.randomUUID(),demoRevision:review.demoWorkspaceRevision}),headers={'Content-Type':'application/json'};if(!preview)headers['Idempotency-Key']=attempt.key;if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(preview?review.demoWorkspaceRevision:attempt.demoRevision);var disabled=Array.prototype.map.call(form.elements,function(e){var old=e.disabled;e.disabled=true;return old;});status.textContent=preview?'Calculating equipment costs.':'Saving equipment costs.';
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/equipment-cost-preview':'/equipment-cost-plans'),{method:'POST',headers:headers,body:JSON.stringify(attempt.body)}).then(function(response){return response.json().catch(function(){return{};}).then(function(b){if(!response.ok)throw{status:response.status,category:b.error&&b.error.category};return b;});}).then(function(b){if(generation!==_openSequence||_equipmentCostDraft!==draft||_estimateReview!==review)return;if(preview){if(!b.success||JSON.stringify(b.data.sourcePins)!==JSON.stringify(review.pins)||!b.data.decisionBasis||b.data.decisionBasis.revision!==plans.decisionBasis.revision||b.data.decisionBasis.digest!==plans.decisionBasis.digest)throw{status:409};draft.result=b.data.result;draft.assessment=b.data.assessment;draft.confirmed=false;confirm.checked=false;draft.request=null;results.replaceChildren();show(draft.result,results);p(draft.assessment.cautions.length?'Source dates, freshness, applicability or rental minimums need confirmation. Explain your assumptions before saving.':'Review the recorded source basis before saving.',results);status.textContent='Review the calculation and source limitations, then confirm.';}else{_equipmentCostDraft=null;refreshEstimateReview('equipment-cost-saved');}}).catch(function(e){if(generation!==_openSequence||_equipmentCostDraft!==draft||_estimateReview!==review)return;var paused=e.status===503&&e.category==='equipment_cost_paused',known=[400,401,403,404,409,410,413,429].indexOf(e.status)>=0||paused;status.textContent=e.status===400&&e.category==='cost_overlap'?'Remove overlapping cost entries. Equipment Operating Expenses includes fuel or energy, consumables and maintenance. Calculate again.':e.status===400?'Check billing quantities, pool coverage, mixed-cost allocations and source assumptions. Calculate again.':e.status===401?'Sign in again before saving.':e.status===403?'Your current account cannot save equipment costs.':e.status===404?'This estimate is unavailable. Choose a current estimate.':e.status===409?'The estimate or equipment sources changed. Refresh, calculate again and confirm.':e.status===410?'This demo session expired. Refresh to start again.':e.status===413?'Shorten the cost and source notes before trying again.':e.status===429?'Saving is limited right now. Check saved history and try later.':paused?'New equipment costs are paused. Refresh to check saved history.':preview?'Equipment cost calculation is unavailable. Try calculating again.':'The save result is unconfirmed. Retry this same attempt without changing entries, or refresh to check saved history.';if(known||preview)invalidate();}).finally(function(){if(generation===_openSequence&&_equipmentCostDraft===draft&&_estimateReview===review){Array.prototype.forEach.call(form.elements,function(e,i){e.disabled=disabled[i];});status.focus();}});
    }
    var actions=el('div',null,form);actions.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;margin-top:.75rem;';if(draft.action==='save')button('Calculate Equipment Costs',function(){send(true);},actions);button(draft.action==='save'?'Save Equipment Costs':'Confirm Cost Withdrawal',function(){send(false);},actions);button('Cancel Equipment Costs',function(){_equipmentCostDraft=null;redraw(canSaveCosts?'cdEquipmentCostStart':'cdEquipmentCostWithdraw');},actions);
  }
  var _equipmentReadinessDraft=null,_pendingEquipmentReplacement=null;
  function renderEquipmentReadiness(review,parent){
    var plans=review.equipmentReadiness,equipment=review.equipmentPlans&&review.equipmentPlans.current,root=document.createElement('details');root.id='cdEquipmentReadiness';root.dataset.equipmentDisclosure='readiness';parent.appendChild(root);
    function el(tag,text,target){var e=document.createElement(tag);if(text)e.textContent=text;(target||root).appendChild(e);return e;}
    function p(text,target){return el('p',text,target);}
    function button(text,fn,target){var b=el('button',text,target);b.type='button';b.className='btn btn-secondary';b.onclick=fn;return b;}
    function section(target,title,key){var d=el('details',null,target);d.dataset.readinessSection=key;el('summary',title,d);return d;}
    var labels={blocked:'Recorded Conflict',needs_review:'Needs Review',no_recorded_conflict:'No Recorded Conflict For This Plan',not_required:'Not Required For This Plan'};
    var reasons={recorded_downtime:'An equipment downtime record is still open.',recorded_checkout:'The equipment is checked out to different work or an operator outside the selected team.',checkout_execution_unknown:'The practice equipment hold names this job, but a linked work record is not recorded.',recorded_fault:'A recorded fault needs review; a maintenance entry does not clear it.',operational_history_unknown:'A complete equipment history is not recorded.',equipment_source_changed:'The equipment configuration or reviewed source needs confirmation.',requirement_not_met:'A recorded job requirement does not match the selected specification.',requirements_unknown:'Some job requirements or specifications still need confirmation.',source_date_unknown_or_expired:'The reported source has no current end date.',reported_out_of_service:'The source reports this equipment is out of service.',reported_condition_problem:'The source reports a condition problem.',condition_unknown:'The current condition has not been reported.',required_window_unknown:'Enter the required start and end time.',quantity_unknown:'The required or reported equipment quantity is missing.',reported_quantity_shortfall:'The reported quantity is below the required quantity.',identified_asset_overlap:'The same identified equipment is required for overlapping work in this plan.',identified_asset_windows_unknown:'Confirm separate work windows before using the same identified equipment for multiple needs.',identified_asset_quantity:'A single identified asset cannot supply more than one item at once.',reported_window_unknown:'The reported availability window is missing.',reported_window_shortfall:'The reported window does not cover this work.',source_expires_before_work_ends:'The source end date falls before the work ends.',location_unknown:'The required or reported location is missing.',location_needs_confirmation:'Confirm that the reported location covers this work.',reported_restrictions:'Review the source’s recorded restrictions.',lead_time_after_work_start:'The reported lead time runs past the start of this work. Confirm delivery timing.',lead_time_unknown:'The source has not stated a lead time.',maintenance_due:'The recorded maintenance date or threshold needs review.',maintenance_meter_unknown:'The maintenance threshold cannot be compared with a current reading in the same unit.',included_equipment_differs:'The estimate still includes costs for a different equipment review.'};
    el('summary','Equipment Readiness');
    if(!plans||plans.contract!=='estimate-equipment-readiness-v1'||JSON.stringify(plans.sourcePins)!==JSON.stringify(review.pins)||plans.simulated!==review.simulated){p('Equipment readiness is unavailable. Refresh this estimate.');return;}
    if(review.simulated)p('Simulated equipment evidence. No real equipment is checked, reserved or dispatched.');
    var current=plans.current;
    function show(result,target){if(!result)return;p(labels[result.status]||'Needs Review',target);var list=el('ul',null,target);result.lines.forEach(function(l,i){var item=el('li','Equipment '+(i+1)+' — '+labels[l.status],list);if(l.hard.length||l.review.length){var more=section(item,'What Needs Review','result-'+l.lineId);l.hard.concat(l.review).forEach(function(code){p(reasons[code]||'Review the current equipment evidence.',more);});}});}
    function sourceDetails(entry,target){if(!entry.inputs)return;entry.inputs.lines.forEach(function(l,i){var d=section(target,'Equipment '+(i+1)+' — Recorded Evidence','saved-'+entry.id+'-'+i),s=l.source;p('Required Quantity: '+(l.quantity===null?'Not Recorded':l.quantity+(l.quantity===1?' Item':' Items')),d);p('Reported Quantity: '+(s.quantity===null?'Not Recorded':s.quantity+(s.quantity===1?' Item':' Items')),d);p('Source: '+({my_observation:'My Observation',supplier_statement:'Supplier Or Rental Statement',company_record:'Company Record'}[s.kind])+' — Human-Recorded',d);if(s.kind==='my_observation')p('This observation applies to this equipment item and work, not company-wide stock.',d);if(s.label)p(s.label,d);if(s.reference)p(s.reference,d);p('Observed: '+(s.observedAt?new Date(s.observedAt).toLocaleString():'Not Recorded')+' · Valid Until: '+(s.validUntil?new Date(s.validUntil).toLocaleString():'Not Recorded'),d);if(s.restrictions)p(s.restrictions,d);var currentFact=plans.sources.equipmentBasis&&entry.inputs.equipmentBasis.planId===plans.sources.equipmentBasis.planId&&plans.sources.lines.find(function(f){return f.lineId===l.lineId;});if(currentFact&&currentFact.declaredCheckout)p(currentFact.declaredCheckout.currentJob?'Simulated Equipment Hold: This practice record names this job. '+(currentFact.declaredCheckout.executionKnown?'An associated work record is present; current assignment still needs review.':'An associated work record is not recorded. Confirm the equipment arrangement before scheduling.'):'Simulated Equipment Hold: This practice record names another job. Resolve the conflicting arrangement before scheduling.',d);if(currentFact&&(currentFact.observations||[]).length){var facts=section(d,'Current Recorded Equipment Notes','operational-'+entry.id+'-'+i);currentFact.observations.forEach(function(note){p(({condition:'Condition',fault:'Fault',maintenance:'Maintenance',downtime_start:'Downtime Started',downtime_end:'Downtime Ended'}[note.kind]||'Equipment Record')+' — '+new Date(note.observedAt).toLocaleString()+': '+note.description,facts);});}if(l.notRequiredReason)p(l.notRequiredReason,d);if(s.leadTime!==null)p('Reported Lead Time: '+s.leadTime+' '+(s.leadTimeUnit==='days'?'Days':'Hours'),d);});}
    if(current&&current.action==='save'){show(current.result,root);if(current.currentSourcesChanged)p('Equipment evidence changed after this review. Its saved assessment remains in history. Review the current information before relying on it.');sourceDetails(current,root);}else p(current?'This readiness review was withdrawn. Saved history remains available.':'No equipment readiness review has been saved.');
    p('These checks inform scheduling review. A report or maintenance entry is not a reservation or permission to use equipment.');
    if(plans.history.length){var history=section(root,'Readiness History','history');plans.history.forEach(function(e){var d=section(history,(e.action==='save'?'Saved':'Withdrawn')+' — '+new Date(e.createdAt).toLocaleString(),'history-'+e.id);p(e.actorName+' — '+e.reason,d);if(e.recordedAssessment)show(e.recordedAssessment,d);});}
    if(_pendingEquipmentReplacement&&_pendingEquipmentReplacement.estimateId!==review.pins.estimateId)_pendingEquipmentReplacement=null;
    if(!_pendingEquipmentReplacement&&current&&current.action==='save'&&equipment&&equipment.action==='save'&&equipment.revision>current.inputs.equipmentBasis.revision){
      var matches=[];current.inputs.lines.forEach(function(l){var next=equipment.inputs.lines.find(function(x){return x.lineId===l.lineId;});if(next)l.alternatives.forEach(function(a){if(next.assetId===a.assetId&&JSON.stringify(next.identity)===JSON.stringify(a.identity))matches.push({readinessId:current.id,equipmentBasis:current.inputs.equipmentBasis,lineId:l.lineId,alternativeId:a.alternativeId});});});
      if(matches.length===1)_pendingEquipmentReplacement={estimateId:review.pins.estimateId,pin:matches[0]};
    }

    if(_pendingEquipmentReplacement)p('Replacement Pending: save the revised Equipment Plan, then confirm a new readiness review. Included costs and the human price review remain unchanged.');
    if(!plans.canMutate){p(plans.mutationsPaused?'New equipment readiness entries are paused. Saved history remains available.':'Select the current estimate to review equipment readiness.');return;}
    var canSave=equipment&&equipment.action==='save',basis=JSON.stringify([review.pins,plans.decisionBasis,current&&current.digest,equipment&&equipment.digest,plans.sources.digest]);
    function redraw(focusId){var open=root.open,nested={};root.querySelectorAll('details[data-readiness-section]').forEach(function(d){nested[d.dataset.readinessSection]=d.open;});root.remove();renderEquipmentReadiness(review,parent);var mounted=document.getElementById('cdEquipmentReadiness');if(mounted){mounted.open=open||!!_equipmentReadinessDraft;mounted.querySelectorAll('details[data-readiness-section]').forEach(function(d){if(Object.prototype.hasOwnProperty.call(nested,d.dataset.readinessSection))d.open=nested[d.dataset.readinessSection];});}var focus=focusId&&document.getElementById(focusId);if(focus){for(var a=focus.parentElement;a&&a!==mounted;a=a.parentElement)if(a.tagName==='DETAILS')a.open=true;focus.focus();}}
    function emptyLine(l){return {lineId:l.lineId,required:true,notRequiredReason:'',quantity:null,start:null,end:null,timeZone:'UTC',location:'',source:{kind:'my_observation',label:'',reference:'',observedAt:null,validUntil:null,quantity:null,start:null,end:null,condition:'unknown',restrictions:'',location:'',leadTime:null,leadTimeUnit:null},maintenance:{dueAt:null,meterKey:null,threshold:null,unit:null,reference:''},alternatives:[]};}
    function start(action){if(action==='save'&&!canSave)return;var old=current&&current.action==='save'&&current.inputs,equipmentBasis=canSave?{planId:equipment.id,revision:equipment.revision,digest:equipment.digest}:null;_equipmentReadinessDraft={estimateId:review.pins.estimateId,basis:basis,action:action,inputs:action==='save'?{equipmentBasis:equipmentBasis,lines:equipment.inputs.lines.map(function(l){var prior=old&&old.equipmentBasis.planId===equipment.id&&old.lines.find(function(x){return x.lineId===l.lineId;});return prior?JSON.parse(JSON.stringify(prior)):emptyLine(l);}),replacement:_pendingEquipmentReplacement?_pendingEquipmentReplacement.pin:null,assessment:null}:null,reason:'',confirmed:false,result:null,assessment:null,request:null};redraw(action==='save'?'cdReadyQuantity-0':'cdReadyReason');}
    if(!_equipmentReadinessDraft){var actions=el('div');actions.style.cssText='display:flex;flex-wrap:wrap;gap:.75rem;margin:.75rem 0;';if(canSave)button(current&&current.action==='save'?'Revise Equipment Readiness':'Review Equipment Readiness',function(){start('save');},actions).id='cdReadinessStart';else p('Save an Equipment Plan before entering a new readiness review.');if(current&&current.action==='save')button('Withdraw Readiness Review',function(){start('withdraw');},actions).id='cdReadinessWithdraw';
      if(current&&current.action==='save'&&canSave&&current.inputs.equipmentBasis.planId===equipment.id)current.inputs.lines.forEach(function(l){l.alternatives.forEach(function(a){var d=section(root,'Compare Equipment Alternative','alternative-'+a.alternativeId),original=equipment.inputs.lines.find(function(x){return x.lineId===l.lineId;});var pair=el('div',null,d);pair.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:.75rem;';var before=el('div',null,pair),after=el('div',null,pair);el('h4','Current Equipment',before);p(original?(Object.values(original.identity).filter(Boolean).join(' · ')||'Identity Not Recorded'):'Earlier Equipment Record',before);el('h4','Proposed Alternative',after);p(Object.values(a.identity).filter(Boolean).join(' · ')||'Identity Not Recorded',after);function comparisonFacts(target,proposed){
          var identity=proposed?a.identity:original&&original.identity,assetId=proposed?a.assetId:original&&original.assetId,asset=review.equipmentPlans.sources.assets.find(function(x){return x.id===assetId;}),fact=(proposed?plans.sources.alternatives:plans.sources.lines).find(function(x){return proposed?x.alternativeId===a.alternativeId:x.lineId===l.lineId;}),research=asset&&asset.research;
          p('Required Quantity: '+(l.quantity===null?'Not Recorded':l.quantity+(l.quantity===1?' Item':' Items')),target);
          p('Required Work Window: '+(l.start&&l.end?new Date(l.start).toLocaleString()+' To '+new Date(l.end).toLocaleString():'Not Recorded'),target);
          var requirements=el('ul',null,target);(original&&original.requirements||[]).forEach(function(q){el('li',q.label+': '+(q.value===null?'Not Recorded':q.value+(q.unit?' '+q.unit:''))+(proposed?' — Comparison Needs Confirmation':''),requirements);});
          if(!original||!original.requirements.length)p('Job Requirements: Not Recorded',target);
          p('Requirement Review: '+(proposed?'Select And Review The Alternative’s Specifications':fact&&fact.requirementStatus==='matches_reviewed_requirements'?'Matches Recorded Requirements Only':fact&&fact.requirementStatus==='conflicts_with_requirement'?'Recorded Requirement Conflict':'Needs Confirmation'),target);
          p('Specification Source: '+(research&&research.state==='reviewed'?'Reviewed Reference; Current Applicability Still Needs Review':'Not Recorded Or Not Currently Reviewed'),target);
          if(research&&research.sources)research.sources.forEach(function(source){p(source.title+(source.publisher?' — '+source.publisher:''),target);});
          p('Reference End Date: '+(research&&research.freshUntil?new Date(research.freshUntil).toLocaleString():'Not Recorded'),target);
          p('Operational History: '+(fact&&fact.complete?'Complete Recorded History':'Unknown Or Incomplete'),target);
          if(fact&&fact.operational){if(fact.operational.downtime)p('Open Downtime Record',target);if(fact.operational.recordedFault)p('Recorded Fault Needs Review',target);if(fact.operational.checkedOut)p('Recorded Checkout Needs Review For This Work',target);}
          p('Latest Equipment Observation: '+(fact&&fact.observedAt?new Date(fact.observedAt).toLocaleString():'Not Recorded'),target);
          if(proposed){p('Reported Condition, Quantity And Work Coverage: Not Recorded For This Replacement',target);p('Restrictions: Confirm For This Replacement',target);p('Comparable Equipment Cost: Not Recorded',target);}
          else{p('Reported Condition: '+({unknown:'Unknown',reported_no_problem:'No Problem Reported',problem_reported:'Problem Reported',out_of_service:'Out Of Service'}[l.source.condition]),target);p('Reported Quantity: '+(l.source.quantity===null?'Not Recorded':l.source.quantity+(l.source.quantity===1?' Item':' Items')),target);p('Reported Work Coverage: '+(l.source.start&&l.source.end?new Date(l.source.start).toLocaleString()+' To '+new Date(l.source.end).toLocaleString():'Not Recorded'),target);p('Source End Date: '+(l.source.validUntil?new Date(l.source.validUntil).toLocaleString():'Not Recorded'),target);p('Restrictions: '+(l.source.restrictions||'None Recorded; Not Verified Absent'),target);
            var costs=review.equipmentCostPlans&&review.equipmentCostPlans.current,costLine=costs&&costs.action==='save'&&costs.currency===review.currency&&costs.inputs.equipmentBasis.planId===equipment.id&&costs.result&&costs.result.lines.find(function(x){return x.lineId===l.lineId;});p('Saved Equipment Cost: '+(costLine&&costLine.complete?decisionMoney(costLine.total,review.currency):'Not Recorded As A Complete Comparable Cost'),target);}
        }
        comparisonFacts(before,false);comparisonFacts(after,true);p('Cost Difference: Unknown Until Comparable Replacement Costs Are Saved',d);p(a.reason,d);p('This starts a new equipment review. Confirm requirements and enter fresh costs separately; no compatibility or price is transferred.',d);button('Review This Replacement',function(){var trigger=document.getElementById('cdEquipmentStart');if(!trigger)return;trigger.click();if(!_equipmentPlanDraft)return;var next=_equipmentPlanDraft.inputs.lines.find(function(x){return x.lineId===l.lineId;});if(!next)return;next.assetId=a.assetId;next.identity=JSON.parse(JSON.stringify(a.identity));next.requirements.forEach(function(q){q.specificationIndex=null;});_equipmentPlanDraft.result=null;_equipmentPlanDraft.assessment=null;_equipmentPlanDraft.confirmed=false;_equipmentPlanDraft.request=null;_pendingEquipmentReplacement={estimateId:review.pins.estimateId,pin:{readinessId:current.id,equipmentBasis:current.inputs.equipmentBasis,lineId:l.lineId,alternativeId:a.alternativeId}};var planRoot=document.getElementById('cdEquipmentPlan'),host=planRoot.parentElement;planRoot.remove();renderEquipmentPlan(review,host);var focus=document.getElementById('cdEquipmentTask-0');if(focus)focus.focus();},d);});});return;}
    var draft=_equipmentReadinessDraft;if(draft.estimateId!==review.pins.estimateId){_equipmentReadinessDraft=null;redraw();return;}if(draft.basis!==basis){draft.basis=basis;draft.confirmed=false;draft.result=null;draft.assessment=null;draft.request=null;draft.changed=true;}root.open=true;
    if(draft.action==='save'&&canSave&&draft.inputs.equipmentBasis.planId!==equipment.id){p('The Equipment Plan changed. Your earlier entries remain here, but start a current review before previewing or saving.');button('Start Current Equipment Review',function(){start('save');});button('Cancel Readiness Review',function(){_equipmentReadinessDraft=null;redraw('cdReadinessStart');});return;}
    var form=el('form');form.onsubmit=function(e){e.preventDefault();};
    function invalidate(){draft.confirmed=false;draft.result=null;draft.assessment=null;draft.request=null;if(draft.inputs)draft.inputs.assessment=null;if(confirm)confirm.checked=false;if(results)results.replaceChildren();}
    function field(target,label,id,value,fn,options,type){var wrap=el('label',label,target);wrap.style.cssText='display:flex;flex-direction:column;gap:.35rem;margin:.65rem 0;';var input=el(options?'select':'input',null,wrap);input.id=id;input.style.cssText='width:100%;box-sizing:border-box;padding:.65rem;color:#172033;background:white;color-scheme:light;font:inherit;border:1px solid #9ca3af;border-radius:.35rem;';if(options)options.forEach(function(o){el('option',o[1],input).value=o[0];});else input.type=type||'text';input.value=value===null?'':value;input.onchange=function(){invalidate();fn(input.value);};if(!options)input.oninput=input.onchange;return input;}
    function instant(target,label,id,value,fn){return field(target,label+' (UTC)',id,value?new Date(value).toISOString().slice(0,16):'',function(v){fn(v?new Date(v+'Z').toISOString():null);},null,'datetime-local');}
    if(draft.action==='save')draft.inputs.lines.forEach(function(l,i){var item=section(form,'Equipment '+(i+1),'line-'+l.lineId);if(i===0)item.open=true;var named=equipment.inputs.lines.find(function(x){return x.lineId===l.lineId;});if(named)p(named.task,item);field(item,'Required Quantity (Items)','cdReadyQuantity-'+i,l.quantity,function(v){l.quantity=v===''?null:Number(v);},null,'number');field(item,'Needed For This Work','cdReadyRequired-'+i,l.required?'yes':'no',function(v){l.required=v==='yes';redraw('cdReadyRequired-'+i);},[['yes','Required'],['no','Not Required']]);if(!l.required)field(item,'Why It Is Not Required','cdReadyNotRequired-'+i,l.notRequiredReason,function(v){l.notRequiredReason=v;}).required=true;
      var windowBox=section(item,'Required Work Window','window-'+l.lineId);instant(windowBox,'Required Start','cdReadyStart-'+i,l.start,function(v){l.start=v;});instant(windowBox,'Required End','cdReadyEnd-'+i,l.end,function(v){l.end=v;});field(windowBox,'Required Location','cdReadyLocation-'+i,l.location,function(v){l.location=v;});
      var source=section(item,'Reported Availability And Condition','source-'+l.lineId),s=l.source;field(source,'Source Type','cdReadySource-'+i,s.kind,function(v){s.kind=v;redraw('cdReadySource-'+i);},[['my_observation','My Observation'],['supplier_statement','Supplier Or Rental Statement'],['company_record','Company Record']]);if(s.kind==='my_observation')p('This observation applies to this equipment item and work, not company-wide stock.',source);p('Record what the source says. Dates left blank mean current availability is unknown.',source);field(source,'Source Name','cdReadyName-'+i,s.label,function(v){s.label=v;});field(source,'Reference','cdReadyReference-'+i,s.reference,function(v){s.reference=v;});instant(source,'Observed At','cdReadyObserved-'+i,s.observedAt,function(v){s.observedAt=v;});instant(source,'Valid Until','cdReadyValid-'+i,s.validUntil,function(v){s.validUntil=v;});field(source,'Reported Quantity (Items)','cdReadyReportedQuantity-'+i,s.quantity,function(v){s.quantity=v===''?null:Number(v);},null,'number');instant(source,'Reported Start','cdReadyReportedStart-'+i,s.start,function(v){s.start=v;});instant(source,'Reported End','cdReadyReportedEnd-'+i,s.end,function(v){s.end=v;});field(source,'Reported Condition','cdReadyCondition-'+i,s.condition,function(v){s.condition=v;},[['unknown','Unknown'],['reported_no_problem','No Problem Reported'],['problem_reported','Problem Reported'],['out_of_service','Out Of Service']]);field(source,'Restrictions Or Concerns','cdReadyRestrictions-'+i,s.restrictions,function(v){s.restrictions=v;});field(source,'Reported Location','cdReadyReportedLocation-'+i,s.location,function(v){s.location=v;});field(source,'Reported Lead Time','cdReadyLead-'+i,s.leadTime,function(v){s.leadTime=v===''?null:Number(v);s.leadTimeUnit=s.leadTime===null?null:s.leadTimeUnit||'hours';},null,'number');field(source,'Lead Time Unit','cdReadyLeadUnit-'+i,s.leadTimeUnit||'hours',function(v){s.leadTimeUnit=s.leadTime===null?null:v;},[['hours','Hours'],['days','Days']]);
      var m=l.maintenance,maintenance=section(item,'Maintenance To Review','maintenance-'+l.lineId);instant(maintenance,'Maintenance Due','cdReadyDue-'+i,m.dueAt,function(v){m.dueAt=v;});field(maintenance,'Meter Name','cdReadyMeter-'+i,m.meterKey,function(v){m.meterKey=v||null;});field(maintenance,'Meter Threshold','cdReadyThreshold-'+i,m.threshold,function(v){m.threshold=v||null;});field(maintenance,'Meter Unit','cdReadyMeterUnit-'+i,m.unit,function(v){m.unit=v||null;});field(maintenance,'Maintenance Reference','cdReadyMaintenanceRef-'+i,m.reference,function(v){m.reference=v;});p('A threshold needs a recorded reading in the same unit. A maintenance entry does not clear a fault or certify safe use.',maintenance);
      var alternatives=section(item,'Equipment Alternatives','alternatives-'+l.lineId);l.alternatives.forEach(function(a,j){var box=section(alternatives,'Alternative '+(j+1),'alternative-input-'+a.alternativeId);field(box,'Recorded Equipment','cdReadyAlternativeAsset-'+i+'-'+j,a.assetId||'',function(v){a.assetId=v||null;var found=review.equipmentPlans.sources.assets.find(function(x){return x.id===v;});a.identity=Object.fromEntries(['manufacturer','model','modelYear','series','engine','configuration','attachments'].map(function(k){return[k,found&&found.privateConfiguration?found.privateConfiguration[k]===undefined?null:found.privateConfiguration[k]:null];}));redraw('cdReadyAlternativeAsset-'+i+'-'+j);},[['','Other Equipment']].concat(review.equipmentPlans.sources.assets.map(function(x){return[x.id,x.name];})));['manufacturer','model','modelYear','series','engine','configuration','attachments'].forEach(function(k){field(box,k.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,function(c){return c.toUpperCase();}),'cdReadyAlternative-'+i+'-'+j+'-'+k,a.identity[k],function(v){a.identity[k]=v||null;});});field(box,'Why Consider This Alternative','cdReadyAlternativeReason-'+i+'-'+j,a.reason,function(v){a.reason=v;}).required=true;button('Remove Alternative',function(){l.alternatives.splice(j,1);invalidate();redraw('cdReadyAddAlternative-'+i);},box);});button('Add Equipment Alternative',function(){if(draft.inputs.lines.reduce(function(n,x){return n+x.alternatives.length;},0)>=12){status.textContent='Use no more than 12 alternatives across this plan.';status.focus();return;}l.alternatives.push({alternativeId:crypto.randomUUID(),assetId:null,identity:Object.fromEntries(['manufacturer','model','modelYear','series','engine','configuration','attachments'].map(function(k){return[k,null];})),reason:''});invalidate();redraw('cdReadyAlternativeAsset-'+i+'-'+(l.alternatives.length-1));},alternatives).id='cdReadyAddAlternative-'+i;
    });
    field(form,'Reason For This Review','cdReadyReason',draft.reason,function(v){draft.reason=v;}).required=true;var results=el('div',null,form);results.id='cdReadyResult';if(draft.result)show(draft.result,results);
    var label=el('label',null,form);label.className='drawer-decision-confirmation';label.style.cssText='display:flex;align-items:flex-start;gap:.65rem;margin:1rem 0;';var confirm=el('input',null,label);confirm.type='checkbox';confirm.id='cdReadyConfirm';confirm.style.cssText='flex:0 0 auto;margin-top:.25rem;width:1rem;height:1rem;min-height:0;padding:0;';confirm.checked=draft.confirmed;el('span',draft.action==='save'?'I reviewed the reported equipment facts, conflicts and missing information. Save this planning review without reserving equipment or approving its use.':'Withdraw this readiness review and retain its saved history.',label);confirm.onchange=function(){draft.confirmed=confirm.checked;draft.request=null;};
    var status=p(draft.changed?'The equipment or estimate changed. Preview again and confirm.':'',form);status.id='cdReadyStatus';status.setAttribute('role','status');status.tabIndex=-1;
    function body(){if(draft.assessment)draft.inputs.assessment=Object.assign({},draft.assessment,{acknowledged:draft.confirmed});return{action:draft.action,expectedRevision:current?current.revision:0,expectedDigest:current?current.digest:'none',sourcePins:review.pins,expectedDecisionRevision:plans.decisionBasis.revision,expectedDecisionDigest:plans.decisionBasis.digest,inputs:draft.action==='save'?draft.inputs:null,currency:review.currency,reason:draft.reason,confirmed:draft.confirmed,confirmationVersion:'estimate-equipment-readiness-v1'};}
    function send(preview){if(!form.reportValidity()||!reviewPinsMatch(review,_currentData&&_currentData.canonical))return;if(!preview&&(!draft.confirmed||draft.action==='save'&&!draft.result)){status.textContent=draft.action==='save'?'Preview the equipment facts and confirm before saving.':'Review and confirm the readiness withdrawal.';status.focus();return;}var generation=_openSequence,attempt=preview?{body:body()}:draft.request||(draft.request={body:JSON.parse(JSON.stringify(body())),key:crypto.randomUUID(),demoRevision:review.demoWorkspaceRevision}),headers={'Content-Type':'application/json'};if(!preview)headers['Idempotency-Key']=attempt.key;if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(preview?review.demoWorkspaceRevision:attempt.demoRevision);var disabled=Array.prototype.map.call(form.elements,function(e){var v=e.disabled;e.disabled=true;return v;});status.textContent=preview?'Reviewing equipment evidence.':'Saving equipment readiness.';
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/equipment-readiness-preview':'/equipment-readiness-plans'),{method:'POST',headers:headers,body:JSON.stringify(attempt.body)}).then(function(response){return response.json().catch(function(){return{};}).then(function(b){if(!response.ok)throw{status:response.status,category:b.error&&b.error.category};return b;});}).then(function(b){if(generation!==_openSequence||_equipmentReadinessDraft!==draft||_estimateReview!==review)return;if(preview){if(!b.success||JSON.stringify(b.data.sourcePins)!==JSON.stringify(review.pins)||!b.data.decisionBasis||b.data.decisionBasis.revision!==plans.decisionBasis.revision||b.data.decisionBasis.digest!==plans.decisionBasis.digest)throw{status:409};draft.result=b.data.result;draft.assessment=b.data.assessment;draft.confirmed=false;confirm.checked=false;draft.request=null;results.replaceChildren();show(draft.result,results);status.textContent='Review the equipment facts and unresolved information, then confirm.';}else{_equipmentReadinessDraft=null;if(draft.action==='save'&&draft.inputs.replacement)_pendingEquipmentReplacement=null;refreshEstimateReview('equipment-readiness-saved');}}).catch(function(e){if(generation!==_openSequence||_equipmentReadinessDraft!==draft||_estimateReview!==review)return;var paused=e.status===503&&e.category==='equipment_readiness_paused',known=[400,401,403,404,409,410,413,429].indexOf(e.status)>=0||paused;status.textContent=e.status===400?'Check equipment quantities, source dates, maintenance units and alternative details. Preview again.':e.status===401?'Sign in again before saving.':e.status===403?'Your current account cannot save equipment readiness.':e.status===404?'This estimate is unavailable. Choose a current estimate.':e.status===409?'The estimate or equipment evidence changed. Refresh, preview again and confirm.':e.status===410?'This demo session expired. Refresh to start again.':e.status===413?'Shorten the equipment and source notes before trying again.':e.status===429?'Saving is limited right now. Check saved history and try later.':paused?'New equipment readiness entries are paused. Refresh to check saved history.':preview?'Equipment evidence is unavailable. Try the preview again.':'The save result is unconfirmed. Retry this same attempt without changing entries, or refresh to check saved history.';if(known||preview)invalidate();}).finally(function(){if(generation===_openSequence&&_equipmentReadinessDraft===draft&&_estimateReview===review){Array.prototype.forEach.call(form.elements,function(e,i){e.disabled=disabled[i];});status.focus();}});
    }
    var actions=el('div',null,form);actions.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;margin-top:.75rem;';if(draft.action==='save')button('Preview Equipment Readiness',function(){send(true);},actions);button(draft.action==='save'?'Save Equipment Readiness':'Confirm Readiness Withdrawal',function(){send(false);},actions);button('Cancel Readiness Review',function(){_equipmentReadinessDraft=null;redraw(canSave?'cdReadinessStart':'cdReadinessWithdraw');},actions);
  }
  var _equipmentPlanDraft=null;
  function renderEquipmentPlan(review,parent){
    var plans=review.equipmentPlans,root=document.createElement('details');root.id='cdEquipmentPlan';parent.appendChild(root);
    function el(tag,text,target){var e=document.createElement(tag);if(text)e.textContent=text;(target||root).appendChild(e);return e;}
    function para(text,target){return el('p',text,target);}
    function button(text,fn,target){var b=el('button',text,target);b.type='button';b.className='btn btn-secondary';b.onclick=fn;return b;}
    el('summary','Equipment Plan');
    if(!plans||plans.contract!=='estimate-equipment-plan-v1'||JSON.stringify(plans.sourcePins)!==JSON.stringify(review.pins)||plans.simulated!==review.simulated){para('Equipment planning is unavailable. Refresh this estimate.');return;}
    var labels={needs_information:'Needs Information',matches_reviewed_requirements:'Recorded Requirements Match',matches_reviewed_requirement:'Matches Reviewed Specification',conflicts_with_requirement:'Requirement Does Not Match'};
    var flags={asset_unavailable:'This equipment record is unavailable.',configuration_changed:'The equipment configuration changed.',source_needs_review:'The equipment source needs review.',identity_incomplete:'Complete the equipment identity and configuration.',reviewed_source_unavailable:'A current reviewed specification is unavailable.',company_reference_unavailable:'A selected company reference is no longer available.'};
    function showResult(result,target){result.lines.forEach(function(l){var section=el('div',null,target);el('h4',l.task+' — '+labels[l.status],section);l.requirements.forEach(function(q){para(q.label+': '+(q.required===null?'Not Recorded':q.required+(q.unit?' '+q.unit:''))+' — '+labels[q.status],section);if(q.specification)para('Reviewed Specification: '+q.specification.value+(q.specification.unit?' '+q.specification.unit:''),section);});l.flags.forEach(function(f){para(flags[f]||'Review the equipment information.',section);});if(l.ownerReview)para(l.ownerReview,section);var refs=el('details',null,section);el('summary','Equipment Sources',refs);para('Access Basis: '+({unknown:'Unknown',owned:'Owned',rented:'Rented',financed:'Financed'}[l.accessBasis])+' — Recorded By The Reviewer',refs);if(l.research){if(l.research.reviewedAt)para('Reviewed '+new Date(l.research.reviewedAt).toLocaleDateString(),refs);if(l.research.freshUntil)para('Source Review Ends '+new Date(l.research.freshUntil).toLocaleDateString(),refs);(l.research.sources||[]).forEach(function(s){para(s.title+(s.publisher?' — '+s.publisher:''),refs);});}l.companyReferences.forEach(function(k){el('h5',k.label,refs);showKnowledge(k.content,refs);});});}
    function showKnowledge(value,target,key){
      if(key==='generation'||key==='state'||/(?:^id$|Id$|Ids$|Key$|Keys$|Digest$|Version$|^version$|^sourceRecordId$|^jsonPointer$)/.test(key||''))return;
      if(key==='needsReview'){if(Array.isArray(value)&&value.length)para('Some company information needs review. Confirm the relevant details before relying on this reference.',target);return;}
      var names={memberCount:'Recorded Members',modelYear:'Model Year',maxRadiusMiles:'Maximum Radius (Miles)',maxTravelMinutes:'Maximum Travel Time (Minutes)',internalReference:'Company Reference',maxJobsPerDay:'Maximum Jobs Per Day'};
      var label=key&&key!=='facts'?(names[key]||key.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\b[a-z]/g,function(c){return c.toUpperCase();})):'';
      if(Array.isArray(value)){if(label&&value.length)el('h5',label,target);value.forEach(function(v){showKnowledge(v,target);});}
      else if(value&&typeof value==='object'){if(label)el('h5',label,target);Object.keys(value).forEach(function(k){showKnowledge(value[k],target,k);});}
      else if(value===null||['string','number','boolean'].indexOf(typeof value)>=0){if(typeof value==='string'&&(/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(value)||/^[a-f0-9]{64}$/i.test(value)))return;var text=value===null?'Not Recorded':typeof value==='boolean'?(value?'Yes':'No'):String(value);if(key==='timeZone'&&typeof value==='string'){try{text=new Intl.DateTimeFormat('en-US',{timeZone:value,timeZoneName:'long'}).formatToParts(new Date()).find(function(p){return p.type==='timeZoneName';}).value;}catch(_){text='Review The Recorded Time Zone';}}if(text)para((label?label+': ':'')+text,target);}
    }
    if(review.simulated)para('Simulated Equipment And Company References. No real equipment or availability is verified.');
    var current=plans.current,basis=JSON.stringify([review.pins,current&&current.digest,plans.decisionBasis,plans.sources.authorityDigest]);
    if(current&&current.action==='save'){showResult(current.result,root);if(!current.sourceBasisCurrent)para('This plan belongs to an earlier estimate. Review it against the current job.');if(current.currentSourcesChanged)para('The equipment or reference information changed since this plan was saved. Review the current sources.');}
    else para(current?'The equipment plan was withdrawn. Its history is retained.':'No equipment plan has been saved.');
    if(plans.history.length){var history=el('details');el('summary','Equipment Plan History',history);plans.history.forEach(function(p){var entry=el('details',null,history);el('summary',(p.action==='save'?'Saved':'Withdrawn')+' — '+new Date(p.createdAt).toLocaleString(),entry);para(p.actorName+' — '+p.reason,entry);if(p.result)showResult(p.result,entry);});}
    para('Compare recorded job requirements with selected specifications. This does not establish safe use, availability or certification, or change the estimate.');
    renderEquipmentReadiness(review,root);
    renderEquipmentCosts(review,root);
    if(!plans.canMutate){para(plans.mutationsPaused?'New equipment plans are paused. Saved history remains available.':'Select the current estimate to review equipment.');return;}
    var identityKeys=['manufacturer','model','modelYear','series','engine','configuration','attachments'],identityLabels=['Manufacturer','Model','Model Year','Series','Engine','Configuration','Attachments'];
    function emptyLine(){var identity={};identityKeys.forEach(function(k){identity[k]=null;});return {lineId:crypto.randomUUID(),task:'',assetId:null,identity:identity,accessBasis:'unknown',requirements:[],knowledgePins:[],ownerReview:''};}
    function rerender(focusId){var open=root.open,nested={};root.querySelectorAll('details[data-equipment-disclosure]').forEach(function(d){nested[d.dataset.equipmentDisclosure]=d.open;});root.remove();renderEquipmentPlan(review,parent);var mounted=document.getElementById('cdEquipmentPlan');if(mounted){mounted.open=open||!!_equipmentPlanDraft;mounted.querySelectorAll('details[data-equipment-disclosure]').forEach(function(d){if(Object.prototype.hasOwnProperty.call(nested,d.dataset.equipmentDisclosure))d.open=nested[d.dataset.equipmentDisclosure];});}var focus=focusId&&document.getElementById(focusId);if(focus){for(var a=focus.parentElement;a&&a!==mounted;a=a.parentElement)if(a.tagName==='DETAILS')a.open=true;focus.focus();}}
    function start(action){_equipmentPlanDraft={estimateId:review.pins.estimateId,basis:basis,action:action,inputs:current&&current.inputs?JSON.parse(JSON.stringify(current.inputs)):{serviceKey:plans.sources.serviceKey,lines:[emptyLine()],assessment:null},reason:'',confirmed:false,result:null,assessment:null,request:null,references:{}};_equipmentPlanDraft.inputs.assessment=null;rerender(action==='save'?'cdEquipmentTask-0':'cdEquipmentReason');}
    if(!_equipmentPlanDraft){button(current&&current.action==='save'?'Revise Equipment Plan':'Plan Equipment',function(){start('save');}).id='cdEquipmentStart';if(current&&current.action==='save')button('Withdraw Equipment Plan',function(){start('withdraw');});return;}
    var draft=_equipmentPlanDraft;if(draft.estimateId!==review.pins.estimateId){_equipmentPlanDraft=null;rerender();return;}
    if(draft.basis!==basis){draft.basis=basis;draft.confirmed=false;draft.result=null;draft.assessment=null;draft.request=null;draft.inputs.assessment=null;draft.references={};draft.changed=true;}
    root.open=true;var form=el('form');form.onsubmit=function(e){e.preventDefault();};
    function invalidate(){draft.result=null;draft.assessment=null;draft.confirmed=false;draft.request=null;draft.inputs.assessment=null;if(confirm)confirm.checked=false;if(results)results.replaceChildren();}
    function field(target,label,id,value,fn,options){var wrap=el('label',label,target);wrap.style.cssText='display:flex;flex-direction:column;gap:0.35rem;margin:0.65rem 0;';var input=el(options?'select':'input',null,wrap);input.id=id;input.style.cssText='width:100%;box-sizing:border-box;padding:0.65rem;color:#172033;background:white;color-scheme:light;font:inherit;border:1px solid #9ca3af;border-radius:0.35rem;';if(options)options.forEach(function(o){el('option',o[1],input).value=o[0];});input.value=value===null?'':value;input.onchange=function(){invalidate();fn(input.value);};if(!options)input.oninput=input.onchange;return input;}
    if(draft.action==='save')draft.inputs.lines.forEach(function(line,i){var box=el('fieldset',null,form);box.style.cssText='min-width:0;margin:1rem 0;padding:0.75rem;border:1px solid var(--border-color,#9ca3af);border-radius:0.5rem;';el('legend','Equipment '+(i+1),box);
      field(box,'Job Task','cdEquipmentTask-'+i,line.task,function(v){line.task=v;}).required=true;
      var choices=[['','Proposed Equipment / Not In My Records']].concat(plans.sources.assets.map(function(a){return[a.id,a.name];}));
      field(box,'Equipment Record','cdEquipmentAsset-'+i,line.assetId||'',function(v){line.assetId=v||null;if(v){var a=plans.sources.assets.find(function(a){return a.id===v;});identityKeys.forEach(function(k){line.identity[k]=a.privateConfiguration[k]===undefined?null:a.privateConfiguration[k];});}else line.identity=emptyLine().identity;line.requirements.forEach(function(q){q.specificationIndex=null;});rerender('cdEquipmentAsset-'+i);},choices);
      var identity=el('details',null,box);identity.dataset.equipmentDisclosure=line.lineId+'-identity';el('summary','Identity And Configuration',identity);identityKeys.forEach(function(k,n){var control=field(identity,identityLabels[n]+' (Blank If Unknown)','cdEquipment-'+k+'-'+i,line.identity[k],function(v){line.identity[k]=v||null;line.requirements.forEach(function(q){q.specificationIndex=null;});});control.readOnly=!!line.assetId;});
      field(box,'Access Basis','cdEquipmentAccess-'+i,line.accessBasis,function(v){line.accessBasis=v;},[['unknown','Unknown'],['owned','Owned'],['rented','Rented'],['financed','Financed']]);
      var requirements=el('details',null,box);requirements.dataset.equipmentDisclosure=line.lineId+'-requirements';el('summary','Job Requirements',requirements);para('Choose the requirement source and an exact specification. Units must match; unrecorded information stays unresolved. Use up to 12 requirements across this plan.',requirements);
      line.requirements.forEach(function(q,j){var row=el('fieldset',null,requirements);row.style.cssText='min-width:0;margin:0.75rem 0;padding:0.65rem;';el('legend','Requirement '+(j+1),row);var prefix='cdEquipmentRequirement-'+i+'-'+j;
        field(row,'Requirement',prefix,q.label,function(v){q.label=v;}).required=true;
        field(row,'Source',prefix+'-origin',q.origin,function(v){q.origin=v;q.scopeKey=null;q.value=null;rerender(prefix+'-origin');},[['owner_entry','My Requirement'],['caller_assertion','Caller Reported'],['recorded_job','Recorded Job Fact']]);
        if(q.origin==='recorded_job'){var facts=Object.keys(plans.sources.scope).filter(function(k){return ['string','number','boolean'].includes(typeof plans.sources.scope[k]);});field(row,'Recorded Job Fact',prefix+'-fact',q.scopeKey||'',function(v){q.scopeKey=v||null;q.value=v?String(plans.sources.scope[v]):null;rerender(prefix+'-fact');},[['','Choose A Recorded Fact']].concat(facts.map(function(k){return[k,k.replace(/([A-Z])/g,' $1').replace(/^./,function(c){return c.toUpperCase();})+': '+String(plans.sources.scope[k])];})));}
        field(row,'Comparison',prefix+'-kind',q.kind,function(v){q.kind=v;if(q.origin!=='recorded_job')q.value=null;q.operator='equals';rerender(prefix+'-kind');},[['numeric','Number'],['categorical','Exact Text']]);
        var value=field(row,'Required Value (Blank If Unknown)',prefix+'-value',q.value,function(v){q.value=v||null;});value.readOnly=q.origin==='recorded_job';
        field(row,'Unit',prefix+'-unit',q.unit,function(v){q.unit=v;});
        field(row,'Requirement Rule',prefix+'-rule',q.operator,function(v){q.operator=v;},q.kind==='numeric'?[['at_least','At Least'],['at_most','At Most'],['equals','Exactly']]:[['equals','Exactly']]);
        var asset=plans.sources.assets.find(function(a){return a.id===line.assetId;}),recorded=draft.references&&draft.references[JSON.stringify(line.identity)],research=asset?asset.research:recorded;
        field(row,'Reviewed Specification',prefix+'-spec',q.specificationIndex===null?'':String(q.specificationIndex),function(v){q.specificationIndex=v===''?null:Number(v);},[['','No Specification Selected']].concat((research&&research.specifications||[]).map(function(s,index){return[String(index),s.name+': '+s.value+(s.unit?' '+s.unit:'')];})));
        button('Remove Requirement',function(){line.requirements.splice(j,1);invalidate();rerender('cdEquipmentTask-'+i);},row);
      });
      if(draft.inputs.lines.reduce(function(total,l){return total+l.requirements.length;},0)<12)button('Add Requirement',function(){line.requirements.push({requirementId:crypto.randomUUID(),label:'',kind:'numeric',operator:'at_least',value:null,unit:'',origin:'owner_entry',scopeKey:null,specificationIndex:null});invalidate();rerender('cdEquipmentRequirement-'+i+'-'+(line.requirements.length-1));var mounted=document.getElementById('cdEquipmentRequirement-'+i+'-'+(line.requirements.length-1));if(mounted)mounted.closest('details').open=true;},requirements);
      var refs=el('details',null,box);refs.dataset.equipmentDisclosure=line.lineId+'-references';el('summary','Company References',refs);if(!plans.sources.knowledge.length)para('No published company references are available for this review.',refs);plans.sources.knowledge.forEach(function(k){var label=el('label',null,refs);label.style.cssText='display:flex;gap:0.65rem;margin:0.75rem 0;';var check=el('input',null,label);check.type='checkbox';check.checked=line.knowledgePins.indexOf(k.publicationId)>=0;el('span',k.label,label);check.onchange=function(){invalidate();line.knowledgePins=line.knowledgePins.filter(function(id){return id!==k.publicationId;});if(check.checked)line.knowledgePins.push(k.publicationId);};showKnowledge(k.content,refs);});
      field(box,'Job-Specific Review Notes','cdEquipmentNotes-'+i,line.ownerReview,function(v){line.ownerReview=v;});
      if(draft.inputs.lines.length>1)button('Remove Equipment',function(){draft.inputs.lines.splice(i,1);invalidate();rerender('cdEquipmentTask-'+Math.max(0,i-1));},box);
    });
    if(draft.action==='save'&&draft.inputs.lines.length<12)button('Add Equipment',function(){draft.inputs.lines.push(emptyLine());invalidate();rerender('cdEquipmentTask-'+(draft.inputs.lines.length-1));},form);
    field(form,'Reason For This Plan','cdEquipmentReason',draft.reason,function(v){draft.reason=v;}).required=true;
    var results=el('div',null,form);results.id='cdEquipmentResult';if(draft.result)showResult(draft.result,results);
    var label=el('label',null,form);label.className='drawer-decision-confirmation';label.style.cssText='display:flex;align-items:flex-start;gap:0.65rem;margin:1rem 0;';var confirm=el('input',null,label);confirm.type='checkbox';confirm.id='cdEquipmentConfirm';confirm.style.cssText='flex:0 0 auto;margin-top:0.25rem;width:1rem;height:1rem;min-height:0;padding:0;';confirm.checked=draft.confirmed;el('span',draft.action==='save'?'I reviewed the equipment, requirements and source limitations. Save this review without changing costs, price, scheduling or permission to use the equipment.':'Withdraw this equipment plan and retain its saved history.',label);confirm.onchange=function(){draft.confirmed=confirm.checked;draft.request=null;};
    var status=para(draft.changed?'The review changed. Preview again and confirm.':'',form);status.id='cdEquipmentStatus';status.setAttribute('role','status');status.tabIndex=-1;
    function body(){if(draft.assessment)draft.inputs.assessment=Object.assign({},draft.assessment,{acknowledged:draft.confirmed});return{action:draft.action,expectedRevision:current?current.revision:0,expectedDigest:current?current.digest:'none',sourcePins:review.pins,expectedDecisionRevision:plans.decisionBasis.revision,expectedDecisionDigest:plans.decisionBasis.digest,inputs:draft.action==='save'?draft.inputs:null,currency:review.currency,reason:draft.reason,confirmed:draft.confirmed,confirmationVersion:'estimate-equipment-plan-v1'};}
    function send(preview){if(!form.reportValidity()||!reviewPinsMatch(review,_currentData&&_currentData.canonical))return;if(!preview&&(!draft.confirmed||draft.action==='save'&&!draft.result)){status.textContent='Preview the equipment review and confirm before saving.';status.focus();return;}var generation=_openSequence,attempt=preview?{body:body()}:draft.request||(draft.request={body:JSON.parse(JSON.stringify(body())),key:crypto.randomUUID(),demoRevision:review.demoWorkspaceRevision}),headers={'Content-Type':'application/json'};if(!preview)headers['Idempotency-Key']=attempt.key;if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(preview?review.demoWorkspaceRevision:attempt.demoRevision);var disabled=Array.prototype.map.call(form.elements,function(e){var v=e.disabled;e.disabled=true;return v;});status.textContent=preview?'Reviewing equipment sources.':'Saving equipment plan.';
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/equipment-plan-preview':'/equipment-plans'),{method:'POST',headers:headers,body:JSON.stringify(attempt.body)}).then(function(response){return response.json().catch(function(){return{};}).then(function(b){if(!response.ok)throw{status:response.status,category:b.error&&b.error.category};return b;});}).then(function(b){if(generation!==_openSequence||_equipmentPlanDraft!==draft||_estimateReview!==review)return;if(preview){if(!b.success||JSON.stringify(b.data.sourcePins)!==JSON.stringify(review.pins)||!b.data.decisionBasis||b.data.decisionBasis.revision!==plans.decisionBasis.revision||b.data.decisionBasis.digest!==plans.decisionBasis.digest)throw{status:409};draft.result=b.data.result;draft.assessment=b.data.assessment;draft.references=draft.references||{};draft.result.lines.forEach(function(l,i){if(l.research){draft.references[JSON.stringify(l.identity)]=l.research;draft.inputs.lines[i].requirements.forEach(function(q,j){var select=document.getElementById('cdEquipmentRequirement-'+i+'-'+j+'-spec');if(select){select.replaceChildren();el('option','No Specification Selected',select).value='';(l.research.specifications||[]).forEach(function(spec,n){el('option',spec.name+': '+spec.value+(spec.unit?' '+spec.unit:''),select).value=String(n);});select.value=q.specificationIndex===null?'':String(q.specificationIndex);}});}});draft.confirmed=false;confirm.checked=false;draft.request=null;results.replaceChildren();showResult(draft.result,results);status.textContent='Review the results and unresolved information, then confirm to save.';}else{_equipmentPlanDraft=null;refreshEstimateReview('equipment-saved');}}).catch(function(e){if(generation!==_openSequence||_equipmentPlanDraft!==draft||_estimateReview!==review)return;var paused=e.status===503&&e.category==='equipment_paused',known=[400,401,403,404,409,410,413,429].indexOf(e.status)>=0||paused;status.textContent=e.status===400?'Check the equipment, requirements and units. Preview again before saving.':e.status===401?'Sign in again before saving.':e.status===403?'Your current account cannot save equipment plans.':e.status===409?'The estimate or sources changed. Refresh, preview again and confirm.':e.status===410?'This demo session expired. Refresh to start again.':e.status===429?'Saving is currently limited. Wait before trying again and check saved history if the limit continues.':e.status===413?'Shorten the equipment and review notes before trying again.':paused?'New equipment plans are paused. Refresh to check saved history.':e.status===404?'This estimate is unavailable. Choose a current estimate.':preview?'Equipment sources are unavailable. Try the preview again.':'The save result is unconfirmed. Retry this same attempt without changing entries, or refresh to check saved history.';if(known||preview)invalidate();}).finally(function(){if(generation===_openSequence&&_equipmentPlanDraft===draft&&_estimateReview===review){Array.prototype.forEach.call(form.elements,function(e,i){e.disabled=disabled[i];});status.focus();}});
    }
    var actions=el('div',null,form);actions.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.75rem;margin-top:0.75rem;';if(draft.action==='save')button('Preview Equipment Review',function(){send(true);},actions);button(draft.action==='save'?'Save Equipment Plan':'Confirm Equipment Withdrawal',function(){send(false);},actions);button('Cancel Equipment Plan',function(){_equipmentPlanDraft=null;rerender('cdEquipmentStart');},actions);
  }

  var _laborPlanDraft = null;
  function renderLaborPlan(review,parent) {
    var plans=review.laborPlans,root=document.createElement('details');root.id='cdLaborPlan';parent.appendChild(root);
    var summary=document.createElement('summary');summary.textContent='Labor Plan';root.appendChild(summary);
    function el(tag,text,target){var e=document.createElement(tag);if(text)e.textContent=text;(target||root).appendChild(e);return e;}
    function para(text,target){return el('p',text,target);}
    function button(text,fn,target){var b=el('button',text,target);b.type='button';b.className='btn btn-secondary';b.onclick=fn;return b;}
    function money(v){return decisionMoney(v,review.currency);}
    function showResult(result,target){para(result.complete?'Labor Cost: '+money(result.total):'Labor Cost Incomplete — Known Cost Subtotal: '+money(result.knownCostSubtotal),target);para('Total Worker-Hours: '+result.workerHours+'. Project duration is not inferred from combined task time.',target);result.lines.forEach(function(l){para(l.task+': '+l.workerHours+' worker-hours'+(l.elapsedHours!==null?' · '+l.elapsedHours+' hours of work time':'')+' · '+(l.total===null?'Needs '+l.missing.join(' And '):money(l.total)),target);});}
    function showCautions(result,target){var names={date_unknown:'Date Not Recorded',not_yet_effective:'Date Is In The Future',freshness_unknown:'Freshness Unknown',expired:'Source Has Expired',applicability_unknown:'Location Or Applicability Not Recorded'};(result.assessment&&result.assessment.cautions||[]).forEach(function(c){var line=draft.inputs.lines.find(function(l){return l.lineId===c.lineId;});para((line?line.task:'Task')+' — '+(c.source==='quantitySource'?'Work-Time Source':'Cost Source')+': '+c.codes.map(function(k){return names[k];}).join('; '),target);});}
    if(!plans||plans.contract!=='estimate-labor-plan-v1'||JSON.stringify(plans.sourcePins)!==JSON.stringify(review.pins)||plans.simulated!==review.simulated){para('Labor planning is unavailable. Refresh this estimate.');return;}
    if(review.adoptedLaborPlan){var included=review.adoptedLaborPlan;para('Included Labor Plan — '+new Date(included.createdAt).toLocaleString());showResult(included.result,root);var savedSources=el('details');el('summary','Included Labor Sources',savedSources);included.inputs.lines.forEach(function(line){para(line.task,savedSources);['quantitySource','rateSource'].forEach(function(key){var source=line[key];para((key==='quantitySource'?'Work Time: ':'Hourly Cost: ')+(source.kind==='my_estimate'?'My Estimate':source.kind==='company_reference'?'Company Reference':'Published Reference')+(source.reference?' — '+source.reference:'')+(source.effectiveOn?' · Effective '+source.effectiveOn:' · Date Not Recorded')+(source.endsOn?' · Ends '+source.endsOn:' · Freshness Unknown')+(source.geography?' · '+source.geography:''),savedSources);if(source.note)para(source.note,savedSources);});});if(included.currentAssessment.cautions.length)para('Some included source dates or applicability need review. These are recorded assumptions.',savedSources);if(!plans.current||plans.current.id!==included.id)para('This estimate retains the included labor plan. Later saved or withdrawn plans do not replace it automatically.');}
    var current=plans.current,basis=JSON.stringify([review.pins,current&&current.digest,plans.decisionBasis]);
    if(current&&current.action==='save'){showResult(current.result,root);if(!current.sourceBasisCurrent)para('This plan was saved for an earlier estimate. Review it before using it again.');var evidence=el('details'),es=el('summary','Saved Sources',evidence);current.inputs.lines.forEach(function(line){para(line.task,evidence);['quantitySource','rateSource'].forEach(function(k){var s=line[k];para((k==='quantitySource'?'Work Time: ':'Hourly Cost: ')+(s.kind==='my_estimate'?'My Estimate':s.kind==='company_reference'?'Company Reference':'Published Reference')+(s.reference?' — '+s.reference:'')+(s.effectiveOn?' · Effective '+s.effectiveOn:' · Date Not Recorded')+(s.endsOn?' · Ends '+s.endsOn:' · Freshness Unknown')+(s.geography?' · '+s.geography:''),evidence);if(s.note)para(s.note,evidence);});});if(current.currentAssessment.cautions.length)para('Some source dates or applicability need review. These are recorded assumptions, not verified payroll or market rates.',evidence);}
    else para(current?'The labor plan was withdrawn. Its history is retained.':'No labor plan has been saved.');
    if(plans.history.length){var history=el('details');el('summary','Labor Plan History',history);plans.history.forEach(function(p){para((p.action==='save'?'Saved':'Withdrawn')+' · '+new Date(p.createdAt).toLocaleString()+' · '+p.actorName,history);para(p.reason,history);if(p.result)showResult(p.result,history);});}
    para('On-site task costs only. Saving a plan does not change the estimate, customer price, schedule or anyone’s pay.');
    if(!plans.canMutate){para(plans.mutationsPaused?'New labor plans are paused. Saved plans remain available.':review.isCurrent===false?'Choose the current estimate to plan labor.':'Labor plans are available to current owners and administrators.');return;}
    function emptySource(){return {kind:'my_estimate',reference:'',note:'',effectiveOn:null,endsOn:null,geography:''};}
    function emptyLine(){return {lineId:crypto.randomUUID(),task:'',basis:'worker_hours',workerHours:'',people:null,elapsedHours:null,quantity:null,unit:null,hoursPerUnit:null,rateMode:'base_burden',hourlyCost:null,burdenPercent:null,quantitySource:emptySource(),rateSource:emptySource()};}
    function rerender(focusId){var wasOpen=root.open;root.remove();renderLaborPlan(review,parent);var mounted=document.getElementById('cdLaborPlan');if(mounted){mounted.open=wasOpen||!!_laborPlanDraft;var control=focusId&&document.getElementById(focusId);if(control)control.focus();}}
    function start(action){_laborPlanDraft={estimateId:review.pins.estimateId,basis:basis,action:action,inputs:current&&current.inputs?JSON.parse(JSON.stringify(current.inputs)):{serviceKey:plans.serviceKey,lines:[emptyLine()],assessment:null},reason:'',confirmed:false,result:null,request:null,explanation:''};_laborPlanDraft.inputs.assessment=null;rerender(action==='save'?'cdLaborTask-0':'cdLaborReason');}
    if(!_laborPlanDraft){var startButton=button(current&&current.action==='save'?'Revise Labor Plan':'Plan Labor Cost',function(){start('save');});startButton.id='cdLaborStart';if(current&&current.action==='save')button('Withdraw Labor Plan',function(){start('withdraw');});return;}
    var draft=_laborPlanDraft;if(draft.estimateId!==review.pins.estimateId){_laborPlanDraft=null;rerender();return;}
    if(draft.basis!==basis){draft.basis=basis;draft.confirmed=false;draft.result=null;draft.request=null;draft.inputs.assessment=null;draft.changed=true;}
    root.open=true;var form=el('form');form.onsubmit=function(e){e.preventDefault();};
    function invalidate(){draft.result=null;draft.confirmed=false;draft.request=null;draft.inputs.assessment=null;if(confirm)confirm.checked=false;if(results)results.replaceChildren();}
    function field(target,label,id,value,fn,type,options){var wrapper=el('label',label,target);wrapper.style.cssText='display:flex;flex-direction:column;gap:0.35rem;margin:0.65rem 0;';var input=el(options?'select':'input',null,wrapper);input.id=id;input.style.cssText='display:block;width:100%;box-sizing:border-box;padding:0.65rem;color:#172033;background:white;color-scheme:light;font:inherit;border:1px solid #9ca3af;border-radius:0.35rem;';if(options)options.forEach(function(o){var op=el('option',o[1],input);op.value=o[0];});else input.type=type||'text';input.value=value===null?'':value;input.onchange=function(){fn(input.value);invalidate();};if(!options)input.oninput=input.onchange;return input;}
    if(draft.action==='save')draft.inputs.lines.forEach(function(line,i){var section=el('fieldset',null,form);section.setAttribute('data-labor-line','');section.style.cssText='min-width:0;margin:1rem 0;padding:0.75rem;border:1px solid var(--border-color, #9ca3af);border-radius:0.5rem;';el('legend','Task '+(i+1),section);
      field(section,'Task','cdLaborTask-'+i,line.task,function(v){line.task=v;}).required=true;
      field(section,'Work-Time Method','cdLaborBasis-'+i,line.basis,function(v){line.basis=v;line.workerHours=line.people=line.elapsedHours=line.quantity=line.unit=line.hoursPerUnit=null;if(v==='worker_hours')line.workerHours='';if(v==='people_time'){line.people=1;line.elapsedHours='';}if(v==='quantity_productivity'){line.quantity='';line.unit='ea';line.hoursPerUnit='';}invalidate();rerender('cdLaborBasis-'+i);},null,[['worker_hours','Total Worker-Hours'],['people_time','People And Work Time'],['quantity_productivity','Quantity And Productivity']]);
      if(line.basis==='worker_hours')field(section,'Total Worker-Hours','cdLaborHours-'+i,line.workerHours,function(v){line.workerHours=v;}).required=true;
      if(line.basis==='people_time'){field(section,'Number Of People','cdLaborPeople-'+i,line.people,function(v){line.people=v===''?null:Number(v);},'number').required=true;field(section,'Work Time Per Person (Hours)','cdLaborElapsed-'+i,line.elapsedHours,function(v){line.elapsedHours=v;}).required=true;}
      if(line.basis==='quantity_productivity'){field(section,'Work Quantity','cdLaborQuantity-'+i,line.quantity,function(v){line.quantity=v;}).required=true;field(section,'Quantity Unit','cdLaborUnit-'+i,line.unit,function(v){line.unit=v;line.quantity='';line.hoursPerUnit='';invalidate();rerender('cdLaborQuantity-'+i);},null,[['ea','Items'],['ft','Feet'],['ft2','Square Feet'],['m','Metres'],['m2','Square Metres'],['yd3','Cubic Yards'],['m3','Cubic Metres']]);field(section,'Worker-Hours Per Unit','cdLaborProductivity-'+i,line.hoursPerUnit,function(v){line.hoursPerUnit=v;}).required=true;}
      field(section,'Hourly Cost Basis','cdLaborMode-'+i,line.rateMode,function(v){line.rateMode=v;line.burdenPercent=null;line.hourlyCost=null;invalidate();rerender('cdLaborRate-'+i);},null,[['base_burden','Base Cost Plus Burden'],['all_in','All-In Cost']]);
      field(section,'Cost Per Worker-Hour ('+review.currency+')','cdLaborRate-'+i,line.hourlyCost,function(v){line.hourlyCost=v===''?null:v;});
      if(line.rateMode==='base_burden')field(section,'Labor Burden (%)','cdLaborBurden-'+i,line.burdenPercent,function(v){line.burdenPercent=v===''?null:v;});else para('All-in cost includes the labor expenses you intend to cover. Do not add them again as another task or equipment charge.',section);
      var sources=el('details',null,section);el('summary','Time And Cost Sources',sources);para('Record your assumptions or references. NorthStar has not verified wages or productivity.',sources);
      ['quantitySource','rateSource'].forEach(function(k){var src=line[k],box=el('div',null,sources),prefix='cdLabor-'+k+'-'+i;el('h4',k==='quantitySource'?'Work-Time Source':'Cost And Burden Source',box);field(box,'Source Type',prefix+'-kind',src.kind,function(v){src.kind=v;},null,[['my_estimate','My Estimate'],['company_reference','Company Reference'],['published_reference','Published Reference']]);field(box,'Reference (Required For Company Or Published Sources)',prefix+'-reference',src.reference,function(v){src.reference=v;});field(box,'Assumptions Or Applicability',prefix+'-note',src.note,function(v){src.note=v;});field(box,'Location Or Service Area',prefix+'-geography',src.geography,function(v){src.geography=v;});field(box,'Effective Date (Optional)',prefix+'-effective',src.effectiveOn,function(v){src.effectiveOn=v||null;},'date');field(box,'End Date (Optional)',prefix+'-ends',src.endsOn,function(v){src.endsOn=v||null;},'date');});
      var lineActions=el('div',null,section);lineActions.style.cssText='display:flex;flex-wrap:wrap;gap:0.75rem;';if(i)button('Move Task Up',function(){draft.inputs.lines.splice(i-1,0,draft.inputs.lines.splice(i,1)[0]);invalidate();rerender('cdLaborTask-'+(i-1));},lineActions);if(i<draft.inputs.lines.length-1)button('Move Task Down',function(){draft.inputs.lines.splice(i+1,0,draft.inputs.lines.splice(i,1)[0]);invalidate();rerender('cdLaborTask-'+(i+1));},lineActions);if(draft.inputs.lines.length>1)button('Remove Task',function(){draft.inputs.lines.splice(i,1);invalidate();rerender('cdLaborTask-'+Math.max(0,i-1));},lineActions);
    });
    if(draft.action==='save'&&draft.inputs.lines.length<20)button('Add Labor Task',function(){draft.inputs.lines.push(emptyLine());invalidate();rerender('cdLaborTask-'+(draft.inputs.lines.length-1));},form);
    field(form,'Reason For This Plan','cdLaborReason',draft.reason,function(v){draft.reason=v;}).required=true;
    var results=el('div',null,form);results.id='cdLaborResult';if(draft.result){showResult(draft.result,results);showCautions(draft.result,results);}
    var explanation=field(form,'Source Assumptions To Confirm','cdLaborExplanation',draft.explanation,function(v){draft.explanation=v;draft.confirmed=false;draft.request=null;if(confirm)confirm.checked=false;});explanation.oninput=explanation.onchange=function(){draft.explanation=explanation.value;draft.confirmed=false;draft.request=null;if(confirm)confirm.checked=false;};
    para('If dates or applicability are unknown or expired, explain the task-specific assumptions you are using. Missing hourly costs remain incomplete.',form);
    var label=el('label',null,form);label.className='drawer-decision-confirmation';label.style.cssText='display:flex;align-items:flex-start;gap:0.65rem;margin:1rem 0;';var confirm=el('input',null,label);confirm.type='checkbox';confirm.id='cdLaborConfirm';confirm.style.cssText='flex:0 0 auto;margin-top:0.25rem;width:1rem;height:1rem;min-height:0;padding:0;';confirm.checked=draft.confirmed;el('span',draft.action==='save'?'I reviewed the tasks, worker-hours, hourly costs and source limitations. Save this plan without changing the estimate or customer price.':'Withdraw this labor plan and retain its saved history.',label);confirm.onchange=function(){draft.confirmed=confirm.checked;draft.request=null;};
    var status=para(draft.changed?'The review changed. Calculate again and confirm.':'',form);status.id='cdLaborStatus';status.setAttribute('role','status');status.tabIndex=-1;
    function body(){if(draft.result)draft.inputs.assessment=Object.assign({},draft.result.assessment,{acknowledged:draft.confirmed,explanation:draft.explanation});return{action:draft.action,expectedRevision:current?current.revision:0,expectedDigest:current?current.digest:'none',sourcePins:review.pins,expectedDecisionRevision:plans.decisionBasis.revision,expectedDecisionDigest:plans.decisionBasis.digest,inputs:draft.action==='save'?draft.inputs:null,currency:review.currency,reason:draft.reason,confirmed:draft.confirmed,confirmationVersion:'estimate-labor-plan-v1'};}
    function send(preview){if(!form.reportValidity()||!reviewPinsMatch(review,_currentData&&_currentData.canonical))return;if(!preview&&(!draft.confirmed||draft.action==='save'&&!draft.result)){status.textContent='Calculate the labor cost and confirm the plan before saving.';status.focus();return;}var generation=_openSequence,attempt=preview?{body:body()}:draft.request||(draft.request={body:JSON.parse(JSON.stringify(body())),key:crypto.randomUUID(),demoRevision:review.demoWorkspaceRevision}),headers={'Content-Type':'application/json'};if(!preview)headers['Idempotency-Key']=attempt.key;if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(preview?review.demoWorkspaceRevision:attempt.demoRevision);var disabled=Array.prototype.map.call(form.elements,function(e){var v=e.disabled;e.disabled=true;return v;});status.textContent=preview?'Calculating labor cost.':'Saving labor plan.';
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/labor-plan-preview':'/labor-plans'),{method:'POST',headers:headers,body:JSON.stringify(attempt.body)}).then(function(response){return response.json().catch(function(){return{};}).then(function(b){if(!response.ok)throw{status:response.status,category:b.error&&b.error.category};return b;});}).then(function(b){if(generation!==_openSequence||_laborPlanDraft!==draft||_estimateReview!==review)return;if(preview){if(!b.success||JSON.stringify(b.data.sourcePins)!==JSON.stringify(review.pins)||!b.data.decisionBasis||b.data.decisionBasis.revision!==plans.decisionBasis.revision||b.data.decisionBasis.digest!==plans.decisionBasis.digest)throw{status:409};draft.result=b.data.result;draft.confirmed=false;confirm.checked=false;draft.request=null;results.replaceChildren();showResult(draft.result,results);showCautions(draft.result,results);status.textContent=draft.result.assessment.cautions.length?'Review the source limitations, explain your assumptions and confirm.':'Review the calculation and confirm to save.';}else{_laborPlanDraft=null;refreshEstimateReview('labor-saved');}}).catch(function(e){if(generation!==_openSequence||_laborPlanDraft!==draft||_estimateReview!==review)return;var paused=e.status===503&&e.category==='labor_paused';var known=[400,401,403,404,409,410,413,429].indexOf(e.status)>=0||paused;status.textContent=e.status===400?'Check the task numbers, cost basis and source confirmation. Calculate again before saving.':e.status===401?'Sign in again before saving.':e.status===403?'Your current account cannot save labor plans.':e.status===409?'This estimate or review changed. Refresh, calculate again and confirm.':e.status===410?'This demo session expired. Refresh to start again.':e.status===429?'Saving is currently limited. Wait before trying again, and check saved history if the limit continues.':e.status===413?'Shorten the task and source notes before trying again.':paused?'New labor plans are paused. Refresh to check saved history.':e.status===404?'This estimate is unavailable. Choose a current estimate.':'The save result is unconfirmed. Retry this same attempt without changing entries, or refresh to check saved history.';if(known){draft.confirmed=false;confirm.checked=false;draft.result=null;draft.request=null;results.replaceChildren();}}).finally(function(){if(generation===_openSequence&&_laborPlanDraft===draft&&_estimateReview===review){Array.prototype.forEach.call(form.elements,function(e,i){e.disabled=disabled[i];});status.focus();}});
    }
    var actions=el('div',null,form);actions.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.75rem;margin-top:0.75rem;';if(draft.action==='save')button('Calculate Labor Cost',function(){send(true);},actions);button(draft.action==='save'?'Save Labor Plan':'Confirm Labor Withdrawal',function(){send(false);},actions);button('Cancel Labor Plan',function(){_laborPlanDraft=null;rerender('cdLaborStart');},actions);
  }

  function renderMaterialPlan(review,parent) {
    var plans=review.materialPlans,root=document.createElement('section');root.id='cdMaterialPlan';parent.appendChild(root);
    function para(text){var p=document.createElement('p');p.textContent=text;p.style.overflowWrap='anywhere';root.appendChild(p);return p;}
    function button(label,handler,target){var b=document.createElement('button');b.type='button';b.className='btn btn-secondary btn-sm';b.textContent=label;b.style.margin='0.5rem 0.5rem 0 0';b.onclick=handler;(target||root).appendChild(b);return b;}
    if(!plans||plans.contract!=='estimate-material-plan-v4'||JSON.stringify(plans.sourcePins)!==JSON.stringify(review.pins)||plans.simulated!==review.simulated){para('Material planning is unavailable. Refresh this estimate.');return;}
    var current=plans.current;
    if(current&&current.action==='save'){
      para('Latest Material Plan — '+materialLines(current).length+' material'+(materialLines(current).length===1?'':'s'));
      materialResult(current.result,root);materialLines(current).forEach(function(line){materialSource(line,root);materialAvailabilityDetails(line,root);});if(current.currentSourceAssessment&&!sameSourceFlags(current.currentSourceAssessment,current.inputs.sourceAssessment))materialSourceAssessment(current.currentSourceAssessment,root);
      if(current.currentAvailabilityAssessment)materialAvailabilityAssessment(current.currentAvailabilityAssessment,root,current.result.lines);
      para(!current.sourceBasisCurrent?'This plan was saved for a different estimate in this job’s history.':current.expectedDecisionRevision===0&&plans.decisionBasis.revision===0?'No human scope and price decision was recorded when this plan was saved.':current.decisionBasisCurrent?'Saved with the selected estimate’s current scope and price decision.':'The scope and price decision has changed since this plan was saved. Review the plan again before using it.');
      para('Saving or editing a material plan does not automatically change an estimate or customer price. Availability has not been verified.');
    }else para(current?'The material plan was withdrawn. Its history remains available.':'No material plan has been saved for this estimate.');
    if(plans.history.length){var history=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Material Plan History';history.appendChild(summary);plans.history.forEach(function(e){var entry=document.createElement('details'),heading=document.createElement('summary');heading.textContent=(e.action==='save'?'Saved Material Plan':'Withdrew Material Plan')+' — '+e.actorName+' — '+new Date(e.createdAt).toLocaleString()+(e.result?' — '+decisionMoney(e.result.total,e.currency):'');entry.appendChild(heading);var reason=document.createElement('p');reason.textContent=e.reason;entry.appendChild(reason);if(e.result){materialResult(e.result,entry);materialLines(e).forEach(function(line){materialSource(line,entry);materialAvailabilityDetails(line,entry);});}history.appendChild(entry);});if(plans.truncated){var note=document.createElement('p');note.textContent='Showing the latest 20 entries. Earlier history is retained.';history.appendChild(note);}root.appendChild(history);}
    if(!plans.canMutate){para(plans.mutationsPaused?'New material plans are paused. Saved plans and history remain available.':'Material plans are read-only here. Saved plans and history remain available.');return;}
    function evidenceFor(line){return {kind:line.sourceType==='entered_price'?'company_record':'my_estimate',issuer:null,reference:null,effectiveOn:line.priceDate||null,validThrough:null,countryCode:null,region:null,locality:null,serviceKey:review.materialSourceContext&&review.materialSourceContext.serviceKey||null,materialSpecification:null,statedUnit:line.unit,statedCurrency:review.currency,statedUnitPrice:line.unitPrice,appliesToReviewedJob:false,exceptionReason:null};}
    function emptyLine(){return {lineId:crypto.randomUUID(),material:'',quantity:'',unit:'ea',wastePercent:'',unitPrice:'',sourceType:'my_estimate',sourceNote:'',priceDate:null};}
    function start(action){var lines=current&&current.inputs?materialLines(current).map(function(line){return Object.assign({},JSON.parse(JSON.stringify(line)),{lineId:line.lineId||crypto.randomUUID()});}):[Object.assign(emptyLine(),{material:review.materialReview.material||''})];_materialPlanDraft={action:action,estimateId:review.pins.estimateId,basis:materialPlanBasis(review),inputs:{lines:lines,sourceAssessment:null,availabilityAssessment:null},reason:'',confirmed:false,result:null,request:null};render();focusField();}
    function render(){root.remove();renderMaterialPlan(review,parent);}
    function focusField(id){var field=id?$(id):$('cdMaterialPlanForm')&&$('cdMaterialPlanForm').querySelector('input,select');if(field)field.focus();}
    function compareAlternative(index){var lines=JSON.parse(JSON.stringify(current.inputs.lines)),old=lines[index],candidate=emptyLine();candidate.evidence=evidenceFor(candidate);candidate.availability=unknownAvailability();candidate.replacement={previousPlanId:current.id,previousPlanRevision:current.revision,previousPlanDigest:current.digest,previousLineId:old.lineId,reason:'',suitabilityConfirmed:false};lines[index]=candidate;_materialPlanDraft={action:'save',estimateId:review.pins.estimateId,basis:materialPlanBasis(review),inputs:{lines:lines,sourceAssessment:null,availabilityAssessment:null},reason:'',confirmed:false,result:null,request:null,alternative:{index:index,old:old,oldTotal:current.result.total}};render();focusField(index===0?'cdPlanMaterial':'cdPlanMaterial-'+candidate.lineId);}
    if(!_materialPlanDraft&&current&&current.action==='save'&&current.calculationVersion==='estimate-material-plan-v4'){var alternatives=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Compare An Alternative';alternatives.appendChild(heading);root.appendChild(alternatives);current.inputs.lines.forEach(function(l,i){button('Compare Alternative For '+l.material,function(){compareAlternative(i);},alternatives);});}
    if(!_materialPlanDraft){button(current&&current.action==='save'?'Revise Material Plan':'Plan Material Cost',function(){start('save');});if(current&&current.action==='save')button('Withdraw Material Plan',function(){start('withdraw');});return;}
    var draft=_materialPlanDraft;if(draft.estimateId!==review.pins.estimateId){_materialPlanDraft=null;render();return;}
    if(draft.basis!==materialPlanBasis(review)){draft.basis=materialPlanBasis(review);draft.confirmed=false;draft.result=null;draft.request=null;draft.changed=true;}
    var form=document.createElement('form');form.id='cdMaterialPlanForm';root.appendChild(form);
    
    function field(label,id,value,type,target){var wrap=document.createElement('label');wrap.textContent=label;wrap.style.display='block';wrap.style.marginTop='0.75rem';var input=document.createElement(type==='select'?'select':'input');input.id=id;input.value=value===null?'':value;input.style.cssText='display:block;width:100%;box-sizing:border-box;padding:0.65rem;color:#172033;background:white;color-scheme:light;';if(type!=='select')input.type=type||'text';wrap.appendChild(input);(target||form).appendChild(wrap);return input;}
    function invalidate(){draft.inputs.sourceAssessment=null;draft.inputs.availabilityAssessment=null;draft.confirmed=false;draft.result=null;draft.request=null;if(confirm)confirm.checked=false;if(result)result.replaceChildren();if(comparison)compareFacts();}
    if(draft.action==='save'){
      draft.inputs.lines.forEach(function(line,index){if(!line.evidence)line.evidence=evidenceFor(line);if(!line.availability)line.availability=unknownAvailability();if(!Object.prototype.hasOwnProperty.call(line,'replacement'))line.replacement=null;var box=document.createElement('fieldset');box.style.cssText='min-width:0;margin:0.75rem 0;padding:0.75rem;border:1px solid currentColor;border-radius:0.5rem;';box.dataset.materialLine=line.lineId;var legend=document.createElement('legend');legend.textContent='Material '+(index+1);box.appendChild(legend);form.appendChild(box);var suffix=index===0?'':'-'+line.lineId;
        function entry(label,key,id,opts){opts=opts||{};var input=field(label,id+suffix,line[key],opts.type,box);if(opts.max)input.maxLength=opts.max;if(opts.required)input.required=true;if(opts.decimal)input.inputMode='decimal';input.oninput=function(){line[key]=input.value|| (key==='priceDate'?null:'');invalidate();};return input;}
        entry('Material','material','cdPlanMaterial',{max:160,required:true});
        var unit=entry('Unit','unit','cdPlanUnit',{type:'select'});[['ea','Items'],['m','Metres'],['m2','Square Metres'],['m3','Cubic Metres'],['ft','Feet'],['ft2','Square Feet'],['ft3','Cubic Feet'],['yd3','Cubic Yards'],['kg','Kilograms'],['lb','Pounds'],['l','Litres'],['gal','US Liquid Gallons']].forEach(function(x){var o=document.createElement('option');o.value=x[0];o.textContent=x[1];unit.appendChild(o);});unit.value=line.unit;
        var quantity=entry('Required Quantity','quantity','cdPlanQuantity',{decimal:true,required:true});
        entry('Waste Allowance (%)','wastePercent','cdPlanWaste',{decimal:true,required:true});
        var price=entry('Internal Price Per Selected Unit ('+review.currency+')','unitPrice','cdPlanPrice',{decimal:true,required:true});price.placeholder='0.00';
        unit.onchange=function(){line.unit=unit.value;line.availability=unknownAvailability();if(availabilityKind){availabilityKind.value='unknown';availabilityFields();}line.quantity='';line.unitPrice='';quantity.value='';price.value='';invalidate();status.textContent='The unit changed. Enter the quantity and price for this unit.';};
        var sourceBox=document.createElement('details'),sourceSummary=document.createElement('summary');sourceSummary.textContent='Cost Source';sourceBox.appendChild(sourceSummary);box.appendChild(sourceBox);
        var e=line.evidence;
        var kind=field('Source Type','cdSourceKind'+suffix,e.kind,'select',sourceBox);[['my_estimate','My Cost Estimate'],['company_record','Company Record'],['supplier_quote','Supplier Quote'],['published_reference','Published Reference']].forEach(function(x){var o=document.createElement('option');o.value=x[0];o.textContent=x[1];kind.appendChild(o);});kind.value=e.kind;
        var hint=document.createElement('p');hint.textContent='Record information you are permitted to use. NorthStar has not independently verified this source.';sourceBox.appendChild(hint);
        function sourceEntry(label,key,type,max){var el=field(label,'cdSource-'+key+suffix,e[key],type,sourceBox);el.maxLength=max||160;el.oninput=function(){e[key]=el.value||null;invalidate();};return el;}
        var issuer=sourceEntry('Source Name','issuer'),reference=sourceEntry('Document Or Record Reference','reference');
        function relevant(){issuer.parentElement.hidden=e.kind==='my_estimate';reference.parentElement.hidden=e.kind==='my_estimate';issuer.required=e.kind==='supplier_quote'||e.kind==='published_reference';reference.required=e.kind!=='my_estimate';}
        kind.onchange=function(){e.kind=kind.value;line.sourceType=e.kind==='my_estimate'?'my_estimate':'entered_price';invalidate();relevant();};relevant();
        sourceEntry('Effective Date (Optional)','effectiveOn','date');sourceEntry('Valid Through (Optional)','validThrough','date');
        var country=sourceEntry('Country (Optional)','countryCode','select');[['','Not Recorded'],['US','United States'],['CA','Canada'],['GB','United Kingdom'],['AU','Australia'],['NZ','New Zealand'],['IE','Ireland'],['DE','Germany'],['FR','France']].concat(e.countryCode&&!['US','CA','GB','AU','NZ','IE','DE','FR'].includes(e.countryCode)?[[e.countryCode,new Intl.DisplayNames(['en'],{type:'region'}).of(e.countryCode)]]:[]).forEach(function(x){var option=document.createElement('option');option.value=x[0];option.textContent=x[1];country.appendChild(option);});country.value=e.countryCode||'';sourceEntry('Region (Optional)','region');sourceEntry('City Or Area (Optional)','locality');sourceEntry('Material Specification (Optional)','materialSpecification');
        var note=field('Source Note','cdPlanSourceNote'+suffix,line.sourceNote,'text',sourceBox);note.maxLength=1000;note.required=true;note.oninput=function(){line.sourceNote=note.value;invalidate();};
        sourceEntry('Reason For Using An Outdated Or Future Price (If Needed)','exceptionReason','text',500);
        var appliesLabel=document.createElement('label'),applies=document.createElement('input');applies.type='checkbox';applies.id='cdSourceApplies'+suffix;applies.checked=e.appliesToReviewedJob;appliesLabel.style.cssText='display:flex;align-items:flex-start;gap:.65rem;margin-top:.75rem;';applies.style.cssText='flex:0 0 auto;margin-top:.25rem;';appliesLabel.append(applies,document.createTextNode('I may use this information for the business and reviewed its applicability to this job, including any missing dates or location.'));sourceBox.appendChild(appliesLabel);applies.onchange=function(){e.appliesToReviewedJob=applies.checked;invalidate();};
        var availabilityBox=document.createElement('details'),availabilitySummary=document.createElement('summary');availabilitySummary.textContent='Availability And Alternatives';availabilityBox.appendChild(availabilitySummary);box.appendChild(availabilityBox);
        var av=line.availability,availabilityKind=field('Availability Source','cdAvailabilityKind'+suffix,av.kind,'select',availabilityBox);
        [['unknown','Unknown'],['my_observation','My Observation'],['company_record','Company Record'],['supplier_statement','Supplier Statement']].forEach(function(x){var o=document.createElement('option');o.value=x[0];o.textContent=x[1];availabilityKind.appendChild(o);});availabilityKind.value=av.kind;
        var avFields=document.createElement('div');availabilityBox.appendChild(avFields);
        function availabilityFields(){avFields.replaceChildren();av=line.availability;if(av.kind==='unknown'){var p=document.createElement('p');p.textContent='Availability is unknown. You can still review this plan.';avFields.appendChild(p);return;}
          if(av.kind==='my_observation'&&!av.reference){var scope=document.createElement('p');scope.textContent='This observation is for this material line, not a company-wide stock total.';avFields.appendChild(scope);}
          function avField(label,key,type){var el=field(label,'cdAvailability-'+key+suffix,av[key],type,avFields);el.maxLength=key==='exceptionReason'?500:160;el.oninput=function(){av[key]=el.value===''?null:key==='leadTimeDays'?Number(el.value):el.value;if(key==='availableQuantity')av.statedUnit=av.availableQuantity===null?null:line.unit;invalidate();};return el;}
          if(av.kind==='supplier_statement')avField('Source Name','issuer').required=true;
          if(av.kind!=='my_observation')avField('Record Reference','reference').required=true;
          avField('Checked On (Optional)','observedOn','date');avField('Valid Through (Optional)','validThrough','date');avField('Location (Optional)','location');avField('Reported Quantity In Selected Units (Optional)','availableQuantity').inputMode='decimal';var lead=avField('Reported Lead Time After Ordering (Calendar Days)','leadTimeDays','number');lead.min='0';lead.max='3650';lead.step='1';avField('Reason For Using Expired Evidence (If Needed)','exceptionReason');
          var label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.id='cdAvailabilityApplies'+suffix;check.checked=av.appliesToReviewedJob;label.style.cssText='display:flex;gap:.65rem;align-items:flex-start;margin-top:.75rem;';check.style.marginTop='.25rem';label.append(check,document.createTextNode('I reviewed this reported availability for this job. It does not reserve materials.'));avFields.appendChild(label);check.onchange=function(){av.appliesToReviewedJob=check.checked;invalidate();};
        }
        availabilityKind.onchange=function(){line.availability=unknownAvailability();line.availability.kind=availabilityKind.value;invalidate();availabilityFields();};availabilityFields();
        var controls=document.createElement('div');controls.style.cssText='display:flex;gap:0.5rem;flex-wrap:wrap;';box.appendChild(controls);
        function move(offset){invalidate();var other=index+offset;draft.inputs.lines.splice(index,1);draft.inputs.lines.splice(other,0,line);render();focusField(other===0?'cdPlanMaterial':'cdPlanMaterial-'+line.lineId);}
        var up=button('Move Up',function(){move(-1);},controls);up.disabled=index===0;up.setAttribute('aria-label','Move Material '+(index+1)+' Up');
        var down=button('Move Down',function(){move(1);},controls);down.disabled=index===draft.inputs.lines.length-1;down.setAttribute('aria-label','Move Material '+(index+1)+' Down');
        var remove=button('Remove Material',function(){invalidate();draft.inputs.lines.splice(index,1);render();focusField();},controls);remove.disabled=draft.inputs.lines.length===1;remove.setAttribute('aria-label','Remove Material '+(index+1));
        if(draft.alternative){up.disabled=true;down.disabled=true;remove.disabled=true;if(index!==draft.alternative.index)Array.prototype.forEach.call(box.querySelectorAll('input,select,button'),function(el){el.disabled=true;});}
      });
      var add=button('Add Material',function(){invalidate();var line=emptyLine();draft.inputs.lines.push(line);render();focusField('cdPlanMaterial-'+line.lineId);},form);add.disabled=!!draft.alternative||draft.inputs.lines.length>=20;
    }
    if(draft.alternative){var chosen=draft.inputs.lines[draft.alternative.index],why=field('Why This Alternative Meets The Job’s Needs','cdAlternativeReason',chosen.replacement.reason);why.required=true;why.maxLength=500;why.oninput=function(){chosen.replacement.reason=why.value;invalidate();};var suitableLabel=document.createElement('label'),suitable=document.createElement('input');suitable.type='checkbox';suitable.required=true;suitable.id='cdAlternativeSuitable';suitable.checked=chosen.replacement.suitabilityConfirmed;suitableLabel.style.cssText='display:flex;align-items:flex-start;gap:.65rem;margin-top:.75rem;';suitable.style.marginTop='.25rem';suitableLabel.append(suitable,document.createTextNode('I reviewed this alternative’s suitability for this job. NorthStar has not verified interchangeability.'));form.appendChild(suitableLabel);suitable.onchange=function(){chosen.replacement.suitabilityConfirmed=suitable.checked;invalidate();};}
    var reason=field('Reason For This Plan Change','cdPlanReason',draft.reason);reason.maxLength=2000;reason.required=true;reason.oninput=function(){draft.reason=reason.value;draft.confirmed=false;confirm.checked=false;draft.request=null;};
    var result=document.createElement('div');result.id='cdPlanResult';result.setAttribute('aria-live','polite');form.appendChild(result);if(draft.result)materialResult(draft.result,result);
    var comparison;
    function compareFacts(){if(!draft.alternative)return;if(!comparison){comparison=document.createElement('section');comparison.id='cdAlternativeComparison';comparison.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:1rem;margin:1rem 0;';form.insertBefore(comparison,$('cdAlternativeReason').parentElement);}comparison.replaceChildren();
      [false,true].forEach(function(proposed){var section=document.createElement('section'),heading=document.createElement('h4');heading.textContent=proposed?'Proposed Alternative':'Saved Original';section.appendChild(heading);var line=proposed?draft.inputs.lines[draft.alternative.index]:draft.alternative.old;var facts=proposed?draft.result&&draft.result.lines[draft.alternative.index]:current.result.lines[draft.alternative.index];var name=document.createElement('p');name.textContent=line.material||'Material Not Entered';section.appendChild(name);if(facts)materialResult(facts,section);else{var pending=document.createElement('p');pending.textContent='Calculate the alternative to compare its quantity and cost.';section.appendChild(pending);}materialSource(line,section);materialAvailabilityDetails(proposed?Object.assign({},line,{replacement:null}):line,section);var total=document.createElement('p');total.textContent=(proposed?'Proposed Plan Total: ':'Saved Plan Total: ')+(proposed&&!draft.result?'Not Calculated':decisionMoney(proposed?draft.result.total:draft.alternative.oldTotal,review.currency));section.appendChild(total);comparison.appendChild(section);});
    }
    var label=document.createElement('label'),confirm=document.createElement('input');confirm.id='cdPlanConfirm';confirm.type='checkbox';confirm.checked=draft.confirmed;confirm.onchange=function(){draft.confirmed=confirm.checked;draft.request=null;};label.style.cssText='display:flex;align-items:flex-start;gap:0.65rem;margin-top:1rem;';confirm.style.cssText='flex:0 0 auto;margin-top:0.25rem;';label.appendChild(confirm);var consent=document.createElement('span');consent.textContent=draft.action==='save'?'I reviewed every material, quantity and price source. Save this whole plan without changing the estimate or customer price.':'Withdraw this whole material plan while retaining its history.';label.appendChild(consent);form.appendChild(label);compareFacts();
    var status=document.createElement('p');status.id='cdPlanStatus';status.setAttribute('role','status');status.tabIndex=-1;status.textContent=draft.changed?'The review changed. Calculate again and confirm this plan.':'';form.appendChild(status);
    function body(){if(draft.action==='save')draft.inputs.lines.forEach(function(line){line.evidence.statedUnit=line.unit;line.evidence.statedCurrency=review.currency;line.evidence.statedUnitPrice=line.unitPrice;line.priceDate=line.evidence.effectiveOn;});return {action:draft.action,expectedRevision:current?current.revision:0,expectedDigest:current?current.digest:'none',sourcePins:review.pins,expectedDecisionRevision:plans.decisionBasis.revision,expectedDecisionDigest:plans.decisionBasis.digest,inputs:draft.action==='save'?draft.inputs:null,currency:review.currency,reason:draft.reason,confirmed:draft.confirmed,confirmationVersion:'estimate-material-plan-v4'};}
    function focusStart(){var b=Array.prototype.find.call(parent.querySelectorAll('#cdMaterialPlan button'),function(el){return el.textContent==='Revise Material Plan'||el.textContent==='Plan Material Cost';});if(b)b.focus();}
    function send(preview){if(!form.reportValidity()||!reviewPinsMatch(review,_currentData&&_currentData.canonical))return;if(!preview&&(!draft.confirmed||draft.action==='save'&&!draft.result)){status.textContent='Calculate the material cost and confirm the whole plan before saving.';return;}
      var generation=_openSequence,attempt=preview?{body:body()}:draft.request||(draft.request={body:JSON.parse(JSON.stringify(body())),key:crypto.randomUUID(),demoRevision:review.demoWorkspaceRevision});var serialized=JSON.stringify(attempt.body);var disabledBefore=Array.prototype.map.call(form.elements,function(c){var was=c.disabled;c.disabled=true;return was;});status.textContent=preview?'Calculating material costs.':'Saving material plan.';
      var headers={'Content-Type':'application/json'};if(!preview)headers['Idempotency-Key']=attempt.key;if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(preview?review.demoWorkspaceRevision:attempt.demoRevision);
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/material-plan-preview':'/material-plans'),{method:'POST',headers:headers,body:serialized}).then(function(response){return response.json().catch(function(){return {};}).then(function(b){if(!response.ok)throw {status:response.status,availabilityMessage:b.error&&b.error.message};return b;});}).then(function(b){if(generation!==_openSequence||_materialPlanDraft!==draft||_estimateReview!==review)return;if(preview){if(!b.success||JSON.stringify(b.data.sourcePins)!==JSON.stringify(review.pins)||!b.data.decisionBasis||b.data.decisionBasis.revision!==plans.decisionBasis.revision||b.data.decisionBasis.digest!==plans.decisionBasis.digest)throw {status:409};draft.result=b.data.result;draft.inputs.sourceAssessment=draft.result.sourceAssessment;draft.inputs.availabilityAssessment=draft.result.availabilityAssessment;draft.confirmed=false;confirm.checked=false;result.replaceChildren();materialResult(draft.result,result);compareFacts();status.textContent='Review every material and the plan total, then confirm to save.';}else{_materialPlanDraft=null;refreshEstimateReview('material-saved');}}).catch(function(error){if(generation!==_openSequence||_materialPlanDraft!==draft||_estimateReview!==review)return;var known=[400,401,403,409,413,429,503].indexOf(error.status)>=0;status.textContent=error.status===400?availabilityFailure(error.availabilityMessage,draft.inputs):error.status===413?'This plan has too much text. Shorten the source notes and try again.':error.status===401?'Sign in again before saving this plan.':error.status===403?'Your current account cannot save material plans.':error.status===409?'The estimate or review changed. Refresh, calculate again and confirm.':error.status===429?'The material-plan limit was reached. Review saved history before continuing.':error.status===503?'Material planning is unavailable. Refresh to read the saved plan.':'The result is unconfirmed. Retry this same attempt before changing the plan.';if(known){draft.confirmed=false;confirm.checked=false;draft.result=null;draft.request=null;result.replaceChildren();compareFacts();}}).finally(function(){if(generation===_openSequence&&_materialPlanDraft===draft&&_estimateReview===review){Array.prototype.forEach.call(form.elements,function(c,index){c.disabled=disabledBefore[index];});status.focus();}});
    }
    var actions=document.createElement('div');actions.style.cssText='display:flex;flex-wrap:wrap;gap:0.75rem;margin-top:0.75rem;';form.appendChild(actions);
    if(draft.action==='save')button('Calculate Material Cost',function(){send(true);},actions);button(draft.action==='save'?(draft.alternative?'Use Alternative And Save Plan':'Save Material Plan'):'Confirm Material Withdrawal',function(){send(false);},actions);button('Cancel Material Plan',function(){_materialPlanDraft=null;render();focusStart();},actions);form.onsubmit=function(e){e.preventDefault();};
  }

  function renderRevisionSelector(review,parent) {
    if (!review.currentRevision) return;
    var label=document.createElement('label');label.textContent='Estimate history';label.style.cssText='display:block;margin-bottom:0.75rem;';
    var select=document.createElement('select');select.id='cdEstimateRevisionSelect';select.style.cssText='display:block;max-width:100%;padding:0.65rem;color:#172033;background:white;color-scheme:light;';
    function option(value,text){var o=document.createElement('option');o.value=String(value);o.textContent=text;select.appendChild(o);}
    (review.revisionHistory||[]).forEach(function(entry){var date=new Date(entry.createdAt);option(entry.revision,(entry.revision===review.currentRevision?'Current estimate':'Earlier estimate')+(Number.isFinite(date.getTime())?' — '+date.toLocaleString():''));});
    option(1,'Original estimate'+(review.currentRevision===1?' (current)':''));select.value=String(review.selectedRevision);
    select.onchange=function(){_selectedEstimateRevision=Number(select.value);_laborPlanDraft=null;_equipmentPlanDraft=null;_equipmentCostDraft=null;_equipmentReadinessDraft=null;_decisionDraft=null;_materialPlanDraft=null;_adoptionDraft=null;refreshEstimateReview('revision-selected');};label.appendChild(select);parent.appendChild(label);
    if(!review.isCurrent){var note=document.createElement('p');note.textContent='Viewing an earlier estimate. Select the current estimate to make changes.';parent.appendChild(note);}
  }
  function renderMaterialAdoption(review,parent) {
    var root=document.createElement('section');root.id='cdMaterialAdoption';parent.appendChild(root);
    function para(value){var p=document.createElement('p');p.textContent=value;p.style.overflowWrap='anywhere';root.appendChild(p);return p;}
    function button(label,fn,id){var b=document.createElement('button');b.type='button';b.className='btn btn-secondary btn-sm';b.textContent=label;b.id=id||'';b.style.margin='0.5rem 0.5rem 0 0';b.onclick=fn;root.appendChild(b);return b;}
    var available={material:review.materialPlans&&review.materialPlans.current,labor:review.laborPlans&&review.laborPlans.current,equipment:review.equipmentCostPlans&&review.equipmentCostPlans.current};
    var component=_adoptionDraft?_adoptionDraft.component:'material',plan=available[component];
    if(review.adoptionPaused){para('New estimate changes are paused. Saved estimates remain available.');return;}
    if(!review.canAdopt)return;
    var basis=JSON.stringify([review.pins,review.costComponents,review.decisions.writeBasis,available.material&&available.material.digest,available.labor&&available.labor.digest,available.equipment&&available.equipment.digest]);
    if(_adoptionDraft&&_adoptionDraft.basis!==basis){_adoptionDraft.result=null;_adoptionDraft.confirmed=false;_adoptionDraft.request=null;_adoptionDraft.basis=basis;_adoptionDraft.changed=true;}
    function redraw(){root.remove();renderMaterialAdoption(review,parent);}
    if(!_adoptionDraft){['material','labor','equipment'].forEach(function(kind){var saved=available[kind],title={material:'Material',labor:'Labor',equipment:'Equipment Cost'}[kind];if(!saved||saved.action!=='save')return;if(review.costComponents&&review.costComponents[kind]&&review.costComponents[kind].id===saved.id)return;if(JSON.stringify(saved.sourcePins)!==JSON.stringify(review.pins)){para('Review and save the '+kind+' plan for this current estimate before applying it.');return;}if(kind==='equipment'&&!saved.result.complete){para('Resolve the missing equipment costs and outside-cost coverage before applying this plan.');return;}button('Use '+title+' Plan In Estimate',function(){_adoptionDraft={component:kind,basis:basis,reason:'',confirmed:false,result:null,request:null};redraw();$('cdAdoptionReason').focus();},{material:'cdAdoptionStart',labor:'cdLaborAdoptionStart',equipment:'cdEquipmentCostAdoptionStart'}[kind]);});return;}
    if(!plan||plan.action!=='save'){_adoptionDraft=null;redraw();return;}
    var draft=_adoptionDraft,form=document.createElement('form');form.id='cdAdoptionForm';root.appendChild(form);
    var intro=document.createElement('p');intro.textContent='Replace the selected cost with this saved plan. Keep the other included costs and all earlier estimates. Review the job and price again afterward.';form.appendChild(intro);
    var label=document.createElement('label');label.textContent='Reason For Using This '+({material:'Material',labor:'Labor',equipment:'Equipment Cost'}[component])+' Plan';label.style.display='block';
    var reason=document.createElement('textarea');reason.id='cdAdoptionReason';reason.required=true;reason.maxLength=2000;reason.value=draft.reason;reason.style.cssText='display:block;width:100%;box-sizing:border-box;padding:0.65rem;color:#172033;background:white;';label.appendChild(reason);form.appendChild(label);
    var result=document.createElement('div');result.id='cdAdoptionResult';form.appendChild(result);
    function showResult(){result.replaceChildren();if(!draft.result)return;var dl=document.createElement('dl');[['Material','knownDirectMaterialCost'],['Labor','knownInternalLaborCost'],['Equipment','knownEquipmentCost'],['Travel','knownTravelInternalCost'],['Recorded Direct Costs','knownDirectCosts']].forEach(function(row){var term=document.createElement('dt'),value=document.createElement('dd');term.textContent=row[0]+(row[0].toLowerCase()===component?' — Replaced':' — Retained');if(row[0]==='Recorded Direct Costs')term.textContent=row[0];var label='Recorded '+row[0].toLowerCase()+' cost',prior=(review.rows||[]).find(function(r){return r.label===label;});var old=review.financialCosts?review.financialCosts[row[1]]:prior&&prior.amount;if(typeof old==='number'&&Number.isFinite(old)&&old>=0&&/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(String(old))){var oldParts=String(old).split('.');old=oldParts[0]+'.'+(oldParts[1]||'').padEnd(2,'0');}var inactive=draft.result.applicability&&draft.result.applicability[row[0].toLowerCase()]===false;var after=inactive?'Not Applicable':decisionMoney(draft.result[row[1]],review.currency);value.textContent=row[0].toLowerCase()===component?'Before: '+decisionMoney(old,review.currency)+' → After: '+after:after;dl.append(term,value);});result.append(dl);var note=document.createElement('p');note.textContent='Original price and tax stay unchanged. Missing applicable costs keep the total unavailable.';result.append(note);var cautions=document.createElement('p'),a=draft.assessment||{},names={date_unknown:'Date Not Recorded',freshness_unknown:'Freshness Unknown',not_yet_effective:'Future Source Date',expired:'Expired Source',applicability_unknown:'Applicability Not Recorded',availability_unknown:'Availability Unknown',rental_minimum_unknown:'Rental Minimum Not Recorded'};var words=[];function add(code){var word=names[code]||'Source Needs Review';if(words.indexOf(word)<0)words.push(word);}(a.equipmentSource&&a.equipmentSource.cautions||[]).forEach(function(c){c.codes.forEach(add);});(a.laborSource&&a.laborSource.cautions||[]).forEach(function(c){c.codes.forEach(add);});[a.materialSource,a.materialAvailability].forEach(function(x){(x&&x.lines||[]).forEach(function(l){l.flags.forEach(add);});});cautions.textContent=words.length?'Recorded Source Cautions: '+words.join(' · ')+'. Open the included plans for the supporting details.':'Source information remains human-recorded; it has not been independently verified.';result.append(cautions);}showResult();
    var confirmLabel=document.createElement('label'),confirm=document.createElement('input');confirm.id='cdAdoptionConfirm';confirm.type='checkbox';confirm.style.cssText='width:20px;height:20px;min-height:0;padding:0;';confirm.checked=draft.confirmed;confirmLabel.className='drawer-decision-confirmation';confirmLabel.appendChild(confirm);var consentText=document.createElement('span');consentText.textContent='I reviewed the replacement, retained costs and source cautions. Use this plan in a new estimate; my earlier price review does not carry forward.';confirmLabel.appendChild(consentText);form.appendChild(confirmLabel);
    var status=document.createElement('p');status.id='cdAdoptionStatus';status.setAttribute('role','status');status.tabIndex=-1;status.textContent=draft.changed?'The saved information changed. Preview and confirm again.':'';form.appendChild(status);
    reason.oninput=function(){draft.reason=reason.value;draft.confirmed=false;confirm.checked=false;draft.result=null;draft.request=null;showResult();};confirm.onchange=function(){draft.confirmed=confirm.checked;draft.request=null;};
    function formButton(text,fn){var b=document.createElement('button');b.type='button';b.className='btn btn-secondary btn-sm';b.textContent=text;b.style.margin='0.5rem 0.5rem 0 0';b.onclick=fn;form.appendChild(b);}
    function send(preview){
      if(!form.reportValidity())return;if(!preview&&(!draft.result||!draft.confirmed)){status.textContent='Preview the costs, then confirm before saving.';status.focus();return;}
      var v2=component==='equipment'||review.pins.revision&&review.pins.revision.calculationVersion==='estimate-cost-adoption-v2';var body={sourcePins:review.pins,expectedPlanId:plan.id,expectedPlanRevision:plan.revision,expectedPlanDigest:plan.digest,expectedDecisionRevision:review.decisions.writeBasis.revision,expectedDecisionDigest:review.decisions.writeBasis.digest,reason:draft.reason.trim(),confirmed:preview?false:draft.confirmed,confirmationVersion:v2?'estimate-cost-adoption-v2':'estimate-cost-adoption-v1',changedComponent:component,expectedComponents:v2?review.equipmentCostComponents:review.costComponents,assessment:draft.assessment||{}};
      if(!preview&&!draft.request)draft.request={key:crypto.randomUUID(),body:body,demoRevision:review.demoWorkspaceRevision};
      var attempt=preview?{key:crypto.randomUUID(),body:body,demoRevision:review.demoWorkspaceRevision}:draft.request;
      var headers={'Content-Type':'application/json','Idempotency-Key':attempt.key};if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(attempt.demoRevision);
      var generation=_openSequence;Array.prototype.forEach.call(form.elements,function(c){c.disabled=true;});status.textContent=preview?'Preparing cost review.':'Saving estimate.';
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/cost-adoption-preview':'/cost-adoptions'),{method:'POST',headers:headers,body:JSON.stringify(attempt.body)}).then(function(response){return response.json().catch(function(){return {};}).then(function(data){if(!response.ok)throw {status:response.status,category:data.error&&data.error.category};return data;});}).then(function(data){
        if(generation!==_openSequence||_adoptionDraft!==draft||_estimateReview!==review)return;
        if(preview){if(!data.success||JSON.stringify(data.data.sourcePins)!==JSON.stringify(review.pins)||data.data.planId!==plan.id||data.data.planDigest!==plan.digest||!data.data.decisionBasis||data.data.decisionBasis.revision!==review.decisions.writeBasis.revision||data.data.decisionBasis.digest!==review.decisions.writeBasis.digest)throw {status:409};draft.result=data.data.result;draft.assessment=data.data.assessment;draft.confirmed=false;confirm.checked=false;showResult();status.textContent='Review these costs, then confirm to save.';}
        else{_adoptionDraft=null;_decisionDraft=null;_materialPlanDraft=null;_laborPlanDraft=null;_equipmentPlanDraft=null;_equipmentCostDraft=null;_equipmentReadinessDraft=null;_selectedEstimateRevision=null;refreshEstimateReview('adoption-saved');}
      }).catch(function(error){if(generation!==_openSequence||_adoptionDraft!==draft||_estimateReview!==review)return;
        status.textContent=error.status===401?'Sign in again, then reopen this estimate.':error.status===403?'Your current account cannot change this estimate.':error.status===404?'This estimate is unavailable. Refresh or reopen the customer to choose an available estimate.':error.status===413?'This estimate change has too much text. Shorten your reason, then preview and confirm again.':error.status===410?'This demo session expired. Reopen the demo to continue.':error.status===409?'The estimate, plan or price review changed. Refresh and review again.':error.status===400?'Check the plan’s costs, sources and reason before continuing.':error.status===429?'Estimate changes are temporarily or permanently limited. Refresh to check saved history before continuing.':error.status===503&&error.category==='adoption_paused'?'New estimate changes are paused. Refresh to check saved history.':'The save could not be confirmed. Retry this same attempt before changing your entries.';
        if([400,401,403,404,409,410,413,429].indexOf(error.status)>=0||error.category==='adoption_paused'){draft.confirmed=false;confirm.checked=false;draft.result=null;draft.request=null;showResult();}
      }).finally(function(){if(generation===_openSequence&&_adoptionDraft===draft&&_estimateReview===review){Array.prototype.forEach.call(form.elements,function(c){c.disabled=false;});status.focus();}});
    }
    formButton('Preview Estimate Costs',function(){send(true);});formButton('Save New Estimate',function(){send(false);});formButton('Cancel Estimate Change',function(){_adoptionDraft=null;redraw();var start=$({material:'cdAdoptionStart',labor:'cdLaborAdoptionStart',equipment:'cdEquipmentCostAdoptionStart'}[component]);if(start)start.focus();});form.onsubmit=function(e){e.preventDefault();};
  }

  function renderMaterialReview(review, parent) {
    var details = document.createElement('details'); details.id = 'cdMaterialReview';
    var summary = document.createElement('summary'); summary.textContent = 'Material basis'; details.appendChild(summary);
    function paragraph(text) { var node = document.createElement('p'); node.textContent = text; node.style.overflowWrap = 'anywhere'; details.appendChild(node); }
    var material = review.materialReview;
    var matches = material && material.contract === 'NorthStarMaterialReview/v1' &&
      JSON.stringify(material.sourcePins) === JSON.stringify(review.pins) && material.recordedAt === (review.originalRecordedAt || review.recordedAt) &&
      material.currency === review.currency && material.simulated === review.simulated;
    if (review.adoptedMaterialPlan) {
      var adopted=review.adoptedMaterialPlan,inputs=adopted.inputs;
      paragraph('Included Material Plan: '+materialLines(adopted).length+' materials. Recorded Material Cost: '+decisionMoney(review.financialCosts.knownDirectMaterialCost,review.currency)+'.');
      materialResult(review.financialCosts.material,details);if(adopted.currentAvailabilityAssessment)materialAvailabilityAssessment(adopted.currentAvailabilityAssessment,details,review.financialCosts.material.lines);materialLines(adopted).forEach(function(line){materialSource(line,details);materialAvailabilityDetails(line,details);});if(adopted.currentSourceAssessment&&!sameSourceFlags(adopted.currentSourceAssessment,adopted.inputs.sourceAssessment))materialSourceAssessment(adopted.currentSourceAssessment,details);
      paragraph('Current availability has not been verified.');
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

    parent.appendChild(details);
  }

  function capellaTitle() {
    var title = document.createElement('h4'); title.id = 'cdCapellaTitle';
    var mark = document.createElement('span'); mark.className = 'capella-four-star'; mark.setAttribute('aria-hidden','true');
    ['north','east','south','west'].forEach(function(direction) {
      var star = document.createElement('span'); star.className = 'polaris-inline-star capella-star-' + direction; mark.appendChild(star);
    });
    title.append(mark,document.createTextNode('CAPELLA\u2122 Risk Lens')); return title;
  }

  function appendCapellaRefresh(root) {
    var button=document.createElement('button'); button.id='cdCapellaRefresh'; button.type='button'; button.className='btn btn-secondary btn-sm'; button.textContent='Refresh Capella'; button.style.marginTop='.75rem';
    button.disabled=Boolean($('cdEstimateReviewRefresh').disabled);
    button.onclick=function(){refreshEstimateReview('capella-refresh');}; root.appendChild(button);
  }

  function renderCapellaStatus(message) {
    var root = $('cdCapellaReview'); root.replaceChildren(); root.hidden = false;
    var title = capellaTitle();
    var status = document.createElement('p'); status.setAttribute('role','status'); status.textContent = message;
    root.append(title,status); appendCapellaRefresh(root);
  }

  function renderCapellaReview(review) {
    var root = $('cdCapellaReview'); root.replaceChildren(); root.hidden = false;
    var title = capellaTitle(); root.appendChild(title); appendCapellaRefresh(root);
    function paragraph(value) { var p = document.createElement('p'); p.textContent = value; root.insertBefore(p,$('cdCapellaRefresh')); }
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
      }); root.insertBefore(list,$('cdCapellaRefresh'));
    }
    paragraph(risk.limitation);
    var readiness=review.equipmentReadiness&&review.equipmentReadiness.current;if(readiness&&readiness.action==='save'&&(readiness.currentSourcesChanged||readiness.result&&readiness.result.status==='blocked'))paragraph('Equipment readiness needs attention. This cost comparison does not establish that the equipment can be used for the job.');
  }

  function refreshEstimateReview(focusReason) {
    var root = $('cdEstimateReview'), button = $('cdEstimateReviewRefresh');
    var selected = _currentData && _currentData.canonical;
    var generation = _openSequence, request = ++_reviewSequence;
    var restoreFocus = focusReason === 'capella-refresh' || focusReason === 'adoption-saved' || focusReason === 'revision-selected' || focusReason === 'labor-saved' || focusReason === 'material-saved' || focusReason === 'decision-saved' || focusReason === 'review-refresh' || document.activeElement === button || $('cdEstimateDecision').contains(document.activeElement);
    _estimateReview = null; button.disabled = true; $('cdEstimateDecision').replaceChildren();
    renderCapellaStatus('Loading cost comparison.');
    root.replaceChildren(); root.textContent = 'Loading estimate review.'; root.setAttribute('aria-busy', 'true');
    button.disabled = true;
    function current() { return generation === _openSequence && request === _reviewSequence && _currentData && _currentData.canonical === selected && !_drawerEl.hidden; }
    function unavailable(message) { root.replaceChildren(); root.textContent = message; renderCapellaStatus(message); }
    if (!selected || !selected.ids || !selected.ids.estimate) {
      unavailable('No estimate is available for this customer.'); root.setAttribute('aria-busy', 'false'); button.disabled=false; if($('cdCapellaRefresh'))$('cdCapellaRefresh').disabled=false; return;
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
        renderLaborPlan(review, root);
        renderEquipmentPlan(review, root);
        renderMaterialAdoption(review, root);
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
      }).finally(function() { if (current()) { root.setAttribute('aria-busy', 'false'); button.disabled = false; if ($('cdCapellaRefresh')) $('cdCapellaRefresh').disabled=false; if (restoreFocus) { if (focusReason === 'capella-refresh' && $('cdCapellaRefresh')) $('cdCapellaRefresh').focus(); else if (focusReason === 'labor-saved') { var labor=$('cdLaborPlan');if(labor){for(var x=labor;x;x=x.parentElement)if(x.tagName==='DETAILS')x.open=true;var action=labor.querySelector('#cdLaborStart');if(action)action.focus();else button.focus();}} else if (focusReason === 'material-saved') { var material=$('cdMaterialReview');if(material){material.open=true;var action=material.querySelector('#cdMaterialPlan button');if(action)action.focus();else button.focus();} } else if (focusReason === 'decision-saved' || focusReason === 'adoption-saved') focusDecisionAction('approve'); else if(focusReason==='revision-selected'&&$('cdEstimateRevisionSelect'))$('cdEstimateRevisionSelect').focus(); else button.focus(); } } });
  }

  function populateDrawer(data) {
    var executionRecords = $('cdExecutionRecords');
    if (window.NorthStarExecutionLinks) window.NorthStarExecutionLinks.clear(executionRecords);
    executionRecords.replaceChildren();
    (data.canonicalRecords || []).forEach(function(record) {
      var ids = record && record.ids || {};
      var group = document.createElement('div');
      var label = record && record.values && record.values.service && record.values.service.label || 'Recorded Work';
      executionRecords.appendChild(group);
      if (window.NorthStarExecutionLinks) window.NorthStarExecutionLinks.mount(group, {
        appointmentId:ids.appointment, graphId:ids.graph, customerId:ids.customer
      }, {summaryLabel:label});
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
    if (!data.name) missing.push('customer name');
    if (!data.phone) missing.push('phone number');
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
    if (!data.serviceAddress) missing.push('service address');
    if (data.serviceAddress && window.NorthStarNavigationLauncher) {
      var navigationRoot = document.createElement('div'); contactMethods.appendChild(navigationRoot);
      window.NorthStarNavigationLauncher.mount(navigationRoot, { address:data.serviceAddress, label:'service address' });
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
    renderJobDescription(data);
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
      reason.textContent = 'Demo Schedule opens Calendar for this customer. Ask Polaris keeps this record selected.';
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
