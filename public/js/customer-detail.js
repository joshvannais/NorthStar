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
  var _preparedEstimateState = null;
  var _groundedReview = null;
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
    html += '    <button class="drawer-close drawer-close-btn" id="cdDrawerClose" type="button" aria-label="Close customer details"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m7 7 10 10M17 7 7 17"/></svg></button>';
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
    html += '            <details id="cdOriginalPrice"><summary>Original Price Breakdown</summary><p>These are the original recorded amounts.</p><div id="cdPricingBreakdown"><p>No estimate details are available to this account.</p></div></details>';
    html += '            <section class="drawer-review-section" aria-label="Estimate review">';
    html += '              <div id="cdEstimateReview" role="status" aria-live="polite"></div>';
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
    var travelTitle = document.createElement('summary'); travelTitle.textContent = 'Edit Travel And Work Time'; travelDetails.append(travelTitle,travelSection);
    var chargeDetails = document.createElement('details'); chargeDetails.className = 'drawer-polaris-subsection'; chargeDetails.id = 'cdChargeDetails';
    var chargeSummary = document.createElement('summary'); chargeSummary.textContent = 'Original Charge Details'; chargeDetails.append(chargeSummary,charges);
    analysis.append(travelDetails,chargeDetails);
    panel.appendChild(basisDetails);
    var priceDetails = panel.querySelector('.drawer-polaris-pricing'); priceDetails.classList.add('drawer-section');
    priceDetails.id='cdEstimateDetails';priceDetails.querySelector('summary').textContent = 'Estimate Details';priceDetails.open=false;
    var profileSection = $('cdProfileSection');
    var contactDetails = document.createElement('details'); contactDetails.className = 'drawer-section drawer-customer-background';
    var contactTitle = document.createElement('summary'); contactTitle.textContent = 'Customer History';
    contactDetails.append(contactTitle,profileSection);
    contactDetails.appendChild($('cdProbabilityRow'));
    panel.querySelector('.drawer-polaris-context').remove();
    var actionSection = $('cdBtnAskPolaris').closest('.drawer-section'); actionSection.classList.add('drawer-primary-actions');
    var estimateHub=document.createElement('section');estimateHub.id='cdEstimateHub';estimateHub.className='drawer-estimate-hub';estimateHub.hidden=true;
    var workArea=document.createElement('details');workArea.id='cdCustomerWorkArea';workArea.className='drawer-section drawer-primary-disclosure';
    var workTitle=document.createElement('summary');workTitle.textContent='Schedule & Work';workArea.append(workTitle,$('cdExecutionSection'));
    var activityArea=document.createElement('details');activityArea.id='cdCustomerActivityArea';activityArea.className='drawer-section drawer-primary-disclosure';
    var activityTitle=document.createElement('summary');activityTitle.textContent='Activity';activityArea.append(activityTitle,$('cdConversationHistorySection'),$('cdTranscriptDisclosure'),contactDetails);
    panel.append(attention,nextAction);
    priceDetails.appendChild($('cdCapellaReview'));
    content.prepend(actionSection,estimateHub,polarisSection,priceDetails,workArea,activityArea);
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
      scheduling:['Original work estimate: '+measured(values.estimatedProductionDurationHours,'hours'),'Original travel distance: '+measured(travel.distanceMiles,'miles'),'Original travel time: '+measured(travel.minutes,'minutes'),'Original travel charge: '+cost(travel.customerCharge),'Original recorded travel cost: '+cost(travel.knownInternalCost)],
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
    if(window.NorthStarPreparedEstimate)window.NorthStarPreparedEstimate.dispose(_preparedEstimateState);_preparedEstimateState=null;
    if (!customerId) return;
    var generation = ++_openSequence;
    if (window.NorthStarExecutionLinks) window.NorthStarExecutionLinks.clear($('cdExecutionRecords'));
    options = options || {};
    _groundedReview = options.groundedReview || null;
    _sourceContext = {
      source: options.source === 'leads' || options.source === 'communications' ? options.source : 'customer',
      communicationId: typeof options.communicationId === 'string' ? options.communicationId : null
    };

    if(window.NorthStarCommercialTerms)window.NorthStarCommercialTerms.reset();
    _decisionDraft = null; _pricingPlanDraft = null; _pricingPolicyDraft = null; _laborPlanDraft = null; _travelPlanDraft = null; _equipmentPlanDraft = null; _equipmentCostDraft=null; _materialPlanDraft = null; _adoptionDraft = null; _selectedEstimateRevision = null; _estimateReview = null;
    if(_groundedReview&&_groundedReview.target&&Number.isSafeInteger(_groundedReview.target.selectedRevision))_selectedEstimateRevision=_groundedReview.target.selectedRevision;
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
    var parts = value.split('.'); return (currency === 'USD' ? '$' : currency + ' ') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
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

  var _relocatedReviewActions = [];
  var _activeReviewActions = null;
  function restoreReviewActions() {
    _relocatedReviewActions.forEach(function(entry){if(entry.home.isConnected)entry.home.replaceWith(entry.button);});
    _relocatedReviewActions=[];
  }
  function positionPricingReviewActions() {
    restoreReviewActions();
    var choices=[{plan:'cdPricingPlan',actions:'cdPricingActions'},{plan:'cdPolicyPlan',actions:'cdPolicyActions'}];
    var eligible=choices.filter(function(choice){var plan=$(choice.plan);return plan&&plan.open&&$(choice.actions);});
    var owner=eligible.find(function(choice){return choice.actions===_activeReviewActions;})||eligible[eligible.length-1];
    if(!owner){_activeReviewActions=null;return;}
    _activeReviewActions=owner.actions;var actions=$(owner.actions);
    ['cdEstimateReviewRefresh','cdDecisionReviewAction'].forEach(function(id){var button=$(id);if(!button)return;var home=document.createComment('review action home');button.before(home);_relocatedReviewActions.push({button:button,home:home});actions.appendChild(button);});
  }
  function bindReviewActions(root,actions) {
    function activate(){_activeReviewActions=actions.id;positionPricingReviewActions();}
    root.addEventListener('focusin',function(event){if(event.target.id!=='cdEstimateReviewRefresh'&&event.target.id!=='cdDecisionReviewAction')activate();});
    root.addEventListener('toggle',function(event){if(event.target!==root)return;if(root.open)activate();else positionPricingReviewActions();});
    queueMicrotask(positionPricingReviewActions);
  }
  function renderEstimateDecision(review) {
    restoreReviewActions(); var root = $('cdEstimateDecision'); root.replaceChildren();
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
    positionPricingReviewActions();
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
      (p.revision ? review.originalRecordedAt === selected.snapshotCreatedAt && p.revision.number === review.selectedRevision && ['estimate-material-adoption-v1','estimate-material-adoption-v2','estimate-material-adoption-v3','estimate-material-adoption-v4','estimate-cost-adoption-v1','estimate-cost-adoption-v2','estimate-cost-adoption-v3'].indexOf(p.revision.calculationVersion)>=0 : review.recordedAt === selected.snapshotCreatedAt);
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
  function resultPair(target,label,value,emphasis) {
    var list=document.createElement('dl'),row=document.createElement('div'),term=document.createElement('dt'),detail=document.createElement('dd');
    list.className='drawer-result-pair'+(emphasis?' drawer-result-total':'');term.textContent=label;detail.textContent=value;
    row.appendChild(term);row.appendChild(detail);list.appendChild(row);target.appendChild(list);return list;
  }
  function materialResult(result, target) {
    function text(label, value) { resultPair(target,label,value,label==='Plan Total'||label==='Material Cost'); }
    if (result.lines) {
      result.lines.forEach(function(line,index){var section=document.createElement('section');section.className='drawer-result-group';var title=document.createElement('h4');title.textContent=line.material;section.appendChild(title);materialResult(line,section);target.appendChild(section);});
      text('Plan Total',decisionMoney(result.total,result.currency));if(result.sourceAssessment)materialSourceAssessment(result.sourceAssessment,target);if(result.availabilityAssessment)materialAvailabilityAssessment(result.availabilityAssessment,target,result.lines);return;
    }
    text('Required Quantity',result.quantity+' '+result.unitLabel);
    text('Extra For Waste',result.additionalQuantity+' '+result.unitLabel);
    text('Planned Quantity',result.plannedQuantity+' '+result.unitLabel);
    text('Price Per Unit',decisionMoney(result.unitPrice,result.currency));
    text('Material Cost',decisionMoney(result.total,result.currency));
    var note=document.createElement('p');note.className='drawer-result-note';note.textContent=result.rounding;target.appendChild(note);
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
    function showResult(result,target){result.lines.forEach(function(l){var section=el('section',null,target);section.className='drawer-result-group';el('h4',l.task,section);var identity=l.identity||{};para([identity.manufacturer,identity.model,identity.modelYear,identity.series,identity.engine,identity.configuration,identity.attachments].filter(Boolean).join(' \u00b7 ')||'Equipment Identity Not Recorded',section);para(labels[l.status],section);l.requirements.forEach(function(q){var comparison=el('section',null,section);comparison.className='drawer-equipment-comparison';el('h5',q.label,comparison);resultPair(comparison,'Job Requirement',q.required===null?'Not Recorded':q.required+(q.unit?' '+q.unit:''));resultPair(comparison,'Recorded Specification',q.specification?q.specification.value+(q.specification.unit?' '+q.specification.unit:''):'Not Recorded');para(labels[q.status],comparison);});l.flags.forEach(function(f){para(flags[f]||'Review the equipment information.',section);});if(l.ownerReview)para(l.ownerReview,section);var refs=el('details',null,section);el('summary','Equipment Sources',refs);para('Access Basis: '+({unknown:'Unknown',owned:'Owned',rented:'Rented',financed:'Financed'}[l.accessBasis])+' — Recorded By The Reviewer',refs);if(l.research){if(l.research.reviewedAt)para('Reviewed '+new Date(l.research.reviewedAt).toLocaleDateString(),refs);if(l.research.freshUntil)para('Source Review Ends '+new Date(l.research.freshUntil).toLocaleDateString(),refs);(l.research.sources||[]).forEach(function(s){para(s.title+(s.publisher?' — '+s.publisher:''),refs);});}l.companyReferences.forEach(function(k){el('h5',k.label,refs);showKnowledge(k.content,refs);});});}
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
  var _travelPlanDraft = null;
  function renderTravelStatus(message) {
    var parent=$('cdTravelDetails');if(!parent)return;var previous=$('cdTravelPlan');if(previous)previous.remove();
    var root=document.createElement('details');root.id='cdTravelPlan';var summary=document.createElement('summary');summary.textContent='Travel Plan';var status=document.createElement('p');status.textContent=message;status.setAttribute('role','status');root.append(summary,status);parent.appendChild(root);
  }

  function renderTravelResourceReview(parent,review,timing) {
    function add(tag,text,to){var e=document.createElement(tag);e.textContent=text;(to||parent).appendChild(e);return e;}
    function minutes(value){if(!value)return 'Unknown';var n=Number(value.numerator)/Number(value.denominator);return new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(n);}
    if(timing)add('p','Declared Elapsed Time: '+minutes(timing.declaredElapsedMinutes)+' Minutes. This does not change appointment times or labor cost.');
    if(!review)return;
    if(review.needsReview)add('p','Review the recorded equipment, task allocation and where people will be before relying on this plan.');
    var labels={haul_equipment_unknown:'Hauling equipment has not been selected.',resource_basis_unknown:'A resource is not linked to recorded equipment or an included labor task.',task_headcount_unknown:'An included task has no recorded crew headcount.',stage_presence_unknown:'A stage does not yet say whether its people and equipment are onsite or away.',resource_source_changed:'A saved equipment or labor source changed. Refresh and review the selection.'};
    Array.from(new Set((review.unknown||[]).map(function(x){return labels[x.kind]||'Some resource information is not yet recorded.';}))).forEach(function(text){add('p',text);});
    if(review.absenceWindows&&review.absenceWindows.length){var box=add('details',''),summary=add('summary','Crew Presence By Work Stage',box);review.absenceWindows.forEach(function(w){var row=add('div','',box);add('h4',w.task,row);add('p',minutes(w.start)+'–'+minutes(w.end)+' Minutes Into The Declared Plan',row);add('p',w.awayPositions+' Positions Away · '+w.explicitOnsitePositions+' Positions Explicitly Onsite · '+(w.remainingOnsite===null?'Full Onsite Count Unknown':w.remainingOnsite+' Positions Onsite'),row);add('p',w.stages.join(' · '),row);});add('p','These are declared task positions. Unallocated people are not assumed onsite, productive or qualified.',box);}
  }

  function renderTravelPlan(review) {
    var parent=$('cdTravelDetails');if(!parent)return;
    var previous=$('cdTravelPlan');if(previous)previous.remove();
    var root=document.createElement('details');root.id='cdTravelPlan';root.className='drawer-travel-plan';parent.appendChild(root);
    function el(tag,text,target){var node=document.createElement(tag);if(text)node.textContent=text;(target||root).appendChild(node);return node;}
    el('summary','Travel Plan');
    var plans=review.travelPlans;
    if(!plans||plans.contract!=='estimate-travel-plan-v1'||JSON.stringify(plans.sourcePins)!==JSON.stringify(review.pins)||plans.simulated!==review.simulated){el('p','Travel planning is unavailable. Refresh this estimate.');return;}
    function show(plan,target){
      if(plan.action!=='save'){el('p','This travel plan was withdrawn. Saved history remains available.',target);return;}
      var result=plan.result;
      resultPair(target,result.complete?'Travel Cost':'Known Travel Subtotal',decisionMoney(result.complete?result.total:result.knownCostSubtotal,review.currency),true);if(!result.complete)el('p','Travel costs are incomplete.',target);
      if(result.outsideCoverageRequired&&result.outsideCoverageRequired.length){var recorded=review.adoptedTravelPlan&&review.adoptedTravelPlan.id===plan.id&&review.adoptedTravelPlan.digest===plan.digest&&review.coverageAssessment&&Array.isArray(review.coverageAssessment.travelOutside)&&result.outsideCoverageRequired.every(function(id){return review.coverageAssessment.travelOutside.some(function(row){return row.travelLineId===id;});});el('p',recorded?'Other vehicle costs have a recorded allocation in this estimate’s retained equipment costs. The allocation is not charged again.':'Other vehicle costs are declared as included elsewhere. Review their exact equipment allocation before using this plan in a new estimate.',target);}
      plan.inputs.trips.forEach(function(trip,index){var line=el('div',null,target);line.className='drawer-result-group';el('h4',trip.purpose,line);resultPair(line,'Trip Cost',result.trips[index].complete?decisionMoney(result.trips[index].total,review.currency):'Incomplete',true);el('p',trip.origin.label+' → '+trip.destination.label,line);el('p',(trip.distance.value===null?'Distance Not Recorded':trip.distance.value+' '+(trip.distance.unit==='mi'?'Miles':'Kilometres')+(trip.distance.basis==='straight_line'?' In A Straight Line':' Per Leg'))+' · '+(trip.time.value===null?'Travel Time Not Recorded':trip.time.value+' '+(trip.time.unit==='hour'?'Hours':'Minutes')+' Per Leg'),line);el('p',trip.trips+' '+(trip.trips===1?'Trip':'Trips')+' · '+trip.vehicles+' '+(trip.vehicles===1?'Vehicle':'Vehicles')+' · '+(trip.people===null?'Traveling Headcount Not Recorded':trip.people+' People In The Traveling Group')+(trip.returnIncluded?' · Matching Return Included':''),line);});
      result.logistics.forEach(function(cost,index){resultPair(target,plan.inputs.logistics[index].label,cost.complete?decisionMoney(cost.total,review.currency):'Cost Incomplete');});
      if(result.hauling&&result.hauling.groups.length){var hauling=el('details',null,target);el('summary','Loads And Disposal',hauling);result.hauling.groups.forEach(function(group,index){var input=plan.inputs.hauls[index];el('p',input.label+': '+(group.additionalLoads===null?'Load Count Needs More Information':group.additionalLoads+' Additional Loads'),hauling);(group.cautions||[]).forEach(function(text){el('p',text,hauling);});});}
      if(plan.inputs.stagePlan){var stages=el('details',null,target);el('summary','Planned Work Stages',stages);plan.inputs.stagePlan.stages.forEach(function(stage){el('p',stage.label+': '+(stage.duration===null?'Time Not Recorded':stage.duration+' '+(stage.unit==='hour'?'Hours':'Minutes')),stages);});el('p','Declared stage times do not establish worker qualifications, resource availability or a confirmed appointment.',stages);}
      renderTravelResourceReview(target,plan.resourceReview,result.stagePlan);
      var sources=el('details',null,target);el('summary','Travel Sources',sources);
      plan.inputs.trips.concat(plan.inputs.logistics,plan.inputs.access,plan.inputs.hauls).forEach(function(line){var source=line.source;el('p',(line.purpose||line.label)+' — '+(source.kind==='my_estimate'?'My Estimate':source.kind==='company_reference'?'Company Reference':source.kind==='published_reference'?'Published Reference':'Recorded Caller Information')+(source.reference?' · '+source.reference:'')+(source.effectiveOn?' · Effective '+source.effectiveOn:' · Date Not Recorded')+(source.endsOn?' · Ends '+source.endsOn:' · Freshness Unknown'),sources);if(source.note)el('p',source.note,sources);});
    }
    if(review.simulated)el('p','Simulated Travel Planning');
    if(review.adoptedTravelPlan){el('h4','Travel Included In This Estimate');show(review.adoptedTravelPlan,root);if(!plans.current||plans.current.id!==review.adoptedTravelPlan.id)el('p','This estimate retains its included travel plan. Later changes require a new estimate revision and price review.');}
    if(plans.current&&(!review.adoptedTravelPlan||plans.current.id!==review.adoptedTravelPlan.id)){el('h4','Latest Saved Travel Plan');show(plans.current,root);}else if(!plans.current) el('p','No travel plan has been saved.');
    if(plans.history.length){var history=el('details');el('summary','Travel Plan History',history);plans.history.forEach(function(plan){var item=el('details',null,history);el('summary',(plan.action==='save'?'Saved':'Withdrawn')+' · '+new Date(plan.createdAt).toLocaleString(),item);el('p',plan.actorName+' · '+plan.reason,item);show(plan,item);});}
    el('p','Record known travel details now and add onsite measurements later. Declared routes and work times are not verified driving directions or availability.');
    renderTravelEditor(review,root);
  }

  function renderTravelEditor(review,root) {
    var plans=review.travelPlans,current=plans.current,basis=JSON.stringify([review.pins,current&&current.digest,plans.decisionBasis,plans.sources&&plans.sources.digest]);
    function el(tag,text,target){var e=document.createElement(tag);if(text)e.textContent=text;(target||root).appendChild(e);return e;}
    function para(text,target){return el('p',text,target);}
    function button(text,fn,target){var b=el('button',text,target);b.type='button';b.className='btn btn-secondary';b.onclick=fn;return b;}
    function emptySource(){return {kind:'my_estimate',issuer:'',reference:'',note:'',effectiveOn:null,endsOn:null,geography:''};}
    function location(){return {kind:'declared',label:'',sourceId:null,sourceDigest:null,latitude:null,longitude:null};}
    function trip(){return {lineId:crypto.randomUUID(),purpose:'',origin:location(),destination:location(),distance:{value:null,unit:'mi',basis:'estimated'},time:{value:null,unit:'min',basis:'estimated'},returnIncluded:false,trips:1,vehicles:1,people:null,vehicle:{method:'all_in_distance',rate:null,unit:'mi'},labor:{method:'all_in',rate:null,burdenPercent:null},source:emptySource()};}
    function rerender(id){var opens={};root.querySelectorAll('details[data-travel-disclosure]').forEach(function(d){opens[d.dataset.travelDisclosure]=d.open;});renderTravelPlan(review);var mounted=$('cdTravelPlan');if(mounted){mounted.open=true;mounted.querySelectorAll('details[data-travel-disclosure]').forEach(function(d){if(Object.prototype.hasOwnProperty.call(opens,d.dataset.travelDisclosure))d.open=opens[d.dataset.travelDisclosure];});if(id&&$(id))$(id).focus();}}
    function start(action){_travelPlanDraft={estimateId:review.pins.estimateId,basis:basis,action:action,inputs:current&&current.inputs?JSON.parse(JSON.stringify(current.inputs)):{serviceKey:plans.serviceKey,trips:[trip()],logistics:[],access:[],hauls:[],loadBindings:[],stagePlan:null,assessment:null},reason:'',confirmed:false,result:null,assessment:null,request:null,explanation:''};_travelPlanDraft.inputs.assessment=null;rerender(action==='save'?'cdTravelPurpose-0':'cdTravelReason');}
    if(!plans.canMutate){para(plans.mutationsPaused?'New travel plans are paused. Saved plans remain available.':review.isCurrent===false?'Choose the current estimate to plan travel.':'Travel plans are available to current owners and administrators.');return;}
    if(!_travelPlanDraft){var starts=el('div');starts.className='drawer-travel-actions';var begin=button(current&&current.action==='save'?'Revise Travel Plan':'Plan Travel',function(){start('save');},starts);begin.id='cdTravelStart';if(current&&current.action==='save')button('Withdraw Travel Plan',function(){start('withdraw');},starts);return;}
    var draft=_travelPlanDraft;if(draft.estimateId!==review.pins.estimateId){_travelPlanDraft=null;rerender();return;}
    if(draft.basis!==basis){draft.basis=basis;draft.confirmed=false;draft.result=null;draft.assessment=null;draft.request=null;draft.inputs.assessment=null;draft.changed=true;}
    root.open=true;var form=el('form');form.onsubmit=function(e){e.preventDefault();};
    function invalidate(){draft.result=null;draft.assessment=null;draft.confirmed=false;draft.request=null;draft.inputs.assessment=null;if(confirm)confirm.checked=false;if(results)results.replaceChildren();}
    function field(target,label,id,value,fn,type,options){var wrapper=el('label',label,target);wrapper.style.cssText='display:flex;flex-direction:column;gap:0.35rem;margin:0.65rem 0;';var input=el(options?'select':'input',null,wrapper);input.id=id;input.style.cssText='display:block;width:100%;box-sizing:border-box;padding:0.65rem;color:#172033;background:white;color-scheme:light;font:inherit;border:1px solid #9ca3af;border-radius:0.35rem;';if(options)options.forEach(function(o){var op=el('option',o[1],input);op.value=o[0];});else input.type=type||'text';input.value=value===null||value===undefined?'':value;input.onchange=function(){fn(input.value);invalidate();};if(!options)input.oninput=input.onchange;return input;}
    function amount(target,label,id,value,fn){return field(target,label+' ('+review.currency+')',id,value,function(v){fn(v===''?null:/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(v)?v.split('.')[0]+'.'+(v.split('.')[1]||'').padEnd(2,'0'):v);});}
    function nullable(v){return v===''?null:v;}
    function number(v){return v===''?null:Number(v);}
    function details(target,label,key){var box=el('details',null,target);box.dataset.travelDisclosure=key;el('summary',label,box);return box;}
    function section(target,label){var box=el('fieldset',null,target);box.style.cssText='min-width:0;margin:1rem 0;padding:0.75rem;border:1px solid var(--border-color,#9ca3af);border-radius:0.5rem;';el('legend',label,box);return box;}
    function sourceFields(target,source,key){var box=details(target,'Source And Assumptions',key);field(box,'Source Type',key+'-kind',source.kind,function(v){source.kind=v;},null,[['my_estimate','My Estimate'],['company_reference','Company Reference'],['published_reference','Published Reference'],['recorded_caller','Recorded Caller Information']]);field(box,'Issuer Or Business',key+'-issuer',source.issuer,function(v){source.issuer=v;});field(box,'Reference',key+'-reference',source.reference,function(v){source.reference=v;});field(box,'Assumptions',key+'-note',source.note,function(v){source.note=v;});field(box,'Location Or Applicability',key+'-geography',source.geography,function(v){source.geography=v;});field(box,'Effective Date (Optional)',key+'-effective',source.effectiveOn,function(v){source.effectiveOn=v||null;},'date');field(box,'End Date (Optional)',key+'-ends',source.endsOn,function(v){source.endsOn=v||null;},'date');para('These are recorded assumptions or references, not verified route or supplier information.',box);}
    function locationFields(target,t,k,prefix){var value=t[k],choices=[['declared','Describe A Location']];(plans.sources.locations||[]).forEach(function(l,i){choices.push([String(i),l.label]);});var selected=value.kind==='declared'?'declared':String((plans.sources.locations||[]).findIndex(function(l){return l.kind===value.kind&&l.sourceId===value.sourceId;}));field(target,k==='origin'?'Starting Location':'Destination',prefix+'-source',selected,function(v){t[k]=v==='declared'?location():JSON.parse(JSON.stringify(plans.sources.locations[Number(v)]));invalidate();rerender(prefix+'-source');},null,choices);if(value.kind==='declared')field(target,'Location Description',prefix+'-label',value.label,function(v){value.label=v;}).required=true;}
    if(draft.action==='save'){
      var example=review.simulated&&plans.sources.example;if(!current&&example&&example.version==='simulated-travel-example-v1'){para(example.note,form);button('Use Simulated Travel Example',function(){var sample=trip();sample.purpose='Simulated Job Travel';sample.origin.label=example.origin;sample.destination.label=example.destination;sample.distance={value:example.distance,unit:'mi',basis:'straight_line'};sample.time.value=null;sample.people=null;sample.vehicle.rate=example.vehicleRate;sample.labor.rate=example.laborRate;sample.source.note=example.note;draft.inputs.trips[0]=sample;invalidate();rerender('cdTravel-0-time');},form);}
      draft.inputs.trips.forEach(function(t,i){var box=section(form,'Trip '+(i+1)),prefix='cdTravel-'+i;field(box,'Trip Purpose','cdTravelPurpose-'+i,t.purpose,function(v){t.purpose=v;}).required=true;locationFields(box,t,'origin',prefix+'-origin');locationFields(box,t,'destination',prefix+'-destination');
        field(box,'Distance Per One-Way Leg',prefix+'-distance',t.distance.value,function(v){t.distance.value=nullable(v);});field(box,'Distance Unit',prefix+'-distanceUnit',t.distance.unit,function(v){t.distance.unit=v;t.distance.value=null;invalidate();rerender(prefix+'-distance');},null,[['mi','Miles'],['km','Kilometres']]);field(box,'Distance Basis',prefix+'-distanceBasis',t.distance.basis,function(v){t.distance.basis=v;},null,[['estimated','Estimated Driving Distance'],['reported','Reported Driving Distance'],['straight_line','Straight-Line Distance Only']]);
        field(box,'Travel Time Per One-Way Leg',prefix+'-time',t.time.value,function(v){t.time.value=nullable(v);});field(box,'Time Unit',prefix+'-timeUnit',t.time.unit,function(v){t.time.unit=v;t.time.value=null;invalidate();rerender(prefix+'-time');},null,[['min','Minutes'],['hour','Hours']]);field(box,'Travel Time Basis',prefix+'-timeBasis',t.time.basis,function(v){t.time.basis=v;},null,[['estimated','Estimated'],['reported','Reported']]);
        field(box,'Number Of Trips',prefix+'-trips',t.trips,function(v){t.trips=number(v);},'number').required=true;field(box,'Vehicles Per Trip',prefix+'-vehicles',t.vehicles,function(v){t.vehicles=number(v);},'number').required=true;field(box,'Total People In The Traveling Group (Optional)',prefix+'-people',t.people,function(v){t.people=number(v);},'number');field(box,'Return Leg',prefix+'-return',String(t.returnIncluded),function(v){t.returnIncluded=v==='true';},null,[['false','Record Returns Separately'],['true','Include A Matching Return']]);para('People are counted for the whole group, not once per vehicle. A matching return repeats this distance and time; record a different return as another trip.',box);
        var costs=details(box,'Vehicle And Travel Labor Costs',prefix+'-costs');field(costs,'Vehicle Cost Method',prefix+'-vehicleMethod',t.vehicle.method,function(v){t.vehicle=v==='all_in_distance'?{method:v,rate:null,unit:t.distance.unit}:v==='itemized_distance'?{method:v,rates:['fuel_energy','maintenance','ownership_insurance'].map(function(category){return {category:category,applicable:true,rate:null,unit:t.distance.unit,reason:null};})}:v==='consumption'?{method:v,unit:'us_gal',price:null,basis:'whole_job',quantity:null,efficiency:null,otherCosts:{status:'unknown',note:''}}:v==='job_charge'?{method:v,amount:null,scope:'whole_job'}:{method:v,reason:''};invalidate();rerender(prefix+'-vehicleMethod');},null,[['all_in_distance','All-In Distance Rate'],['itemized_distance','Separate Vehicle Rates'],['consumption','Fuel Or Energy Use'],['job_charge','Declared Vehicle Charge'],['not_applicable','Not Applicable']]);
        var vehicle=t.vehicle;
        if(vehicle.method==='all_in_distance'){amount(costs,'All-In Vehicle Cost Per Distance Unit',prefix+'-vehicleRate',vehicle.rate,function(v){vehicle.rate=v;});field(costs,'Rate Unit',prefix+'-rateUnit',vehicle.unit,function(v){vehicle.unit=v;vehicle.rate=null;invalidate();rerender(prefix+'-vehicleRate');},null,[['mi','Per Mile'],['km','Per Kilometre']]);}
        if(vehicle.method==='itemized_distance')vehicle.rates.forEach(function(rate,j){var category=['Fuel And Energy','Maintenance','Ownership And Insurance'][j],key=prefix+'-category-'+j;field(costs,category+' Applies',key+'-applies',String(rate.applicable),function(v){rate.applicable=v==='true';rate.rate=null;rate.reason=rate.applicable?null:'';invalidate();rerender(key+'-applies');},null,[['true','Yes'],['false','Not Applicable']]);if(rate.applicable){amount(costs,category+' Cost Per Distance Unit',key+'-rate',rate.rate,function(v){rate.rate=v;});field(costs,'Rate Unit',key+'-unit',rate.unit,function(v){rate.unit=v;rate.rate=null;invalidate();rerender(key+'-rate');},null,[['mi','Per Mile'],['km','Per Kilometre']]);}else field(costs,'Why '+category+' Does Not Apply',key+'-reason',rate.reason,function(v){rate.reason=v;}).required=true;});
        if(vehicle.method==='consumption'){
          field(costs,'Fuel Or Energy Unit',prefix+'-fuelUnit',vehicle.unit,function(v){vehicle.unit=v;vehicle.quantity=null;vehicle.price=null;if(vehicle.basis==='efficiency')vehicle.efficiency={value:null,unit:{us_gal:'mi_per_us_gal',l:'l_per_100km',kwh:'kwh_per_100km'}[v]};invalidate();rerender(prefix+'-fuelUnit');},null,[['us_gal','US Gallons'],['l','Litres'],['kwh','Kilowatt-Hours']]);amount(costs,'Cost Per Fuel Or Energy Unit',prefix+'-fuelPrice',vehicle.price,function(v){vehicle.price=v;});field(costs,'Consumption Basis',prefix+'-fuelBasis',vehicle.basis,function(v){vehicle.basis=v;vehicle.quantity=null;vehicle.efficiency=v==='efficiency'?{value:null,unit:{us_gal:'mi_per_us_gal',l:'l_per_100km',kwh:'kwh_per_100km'}[vehicle.unit]}:null;invalidate();rerender(prefix+'-fuelBasis');},null,[['whole_job','Total Use For The Whole Job'],['per_vehicle_leg','Use Per Vehicle Per One-Way Leg'],['efficiency','Use A Recorded Efficiency']]);if(vehicle.basis==='efficiency')field(costs,{us_gal:'Miles Per US Gallon',l:'Litres Per 100 Kilometres',kwh:'Kilowatt-Hours Per 100 Kilometres'}[vehicle.unit],prefix+'-efficiency',vehicle.efficiency.value,function(v){vehicle.efficiency.value=nullable(v);});else field(costs,'Fuel Or Energy Quantity',prefix+'-fuelQuantity',vehicle.quantity,function(v){vehicle.quantity=nullable(v);});field(costs,'Other Vehicle Costs',prefix+'-otherCosts',vehicle.otherCosts.status,function(v){vehicle.otherCosts.status=v;},null,[['unknown','Not Yet Known'],['included_elsewhere','Included In Another Reviewed Cost'],['not_applicable','Not Applicable']]);field(costs,'Other Vehicle Cost Explanation',prefix+'-otherNote',vehicle.otherCosts.note,function(v){vehicle.otherCosts.note=v;}).required=true;
        }
        if(vehicle.method==='job_charge'){amount(costs,'Vehicle Charge',prefix+'-charge',vehicle.amount,function(v){vehicle.amount=v;});field(costs,'Charge Covers',prefix+'-chargeScope',vehicle.scope,function(v){vehicle.scope=v;},null,[['whole_job','The Whole Job'],['per_vehicle_trip','Each Vehicle Trip Including Its Return']]);}
        if(vehicle.method==='not_applicable')field(costs,'Why Vehicle Cost Does Not Apply',prefix+'-vehicleReason',vehicle.reason,function(v){vehicle.reason=v;}).required=true;
        field(costs,'Travel Labor Cost Method',prefix+'-laborMethod',t.labor.method,function(v){t.labor=v==='not_applicable'?{method:v,reason:''}:{method:v,rate:null,burdenPercent:null};invalidate();rerender(prefix+'-laborMethod');},null,[['all_in','All-In Hourly Cost'],['base_burden','Base Hourly Cost Plus Burden'],['not_applicable','Not Applicable']]);if(t.labor.method==='not_applicable')field(costs,'Why Travel Labor Does Not Apply',prefix+'-laborReason',t.labor.reason,function(v){t.labor.reason=v;}).required=true;else{amount(costs,'Cost Per Worker-Hour',prefix+'-laborRate',t.labor.rate,function(v){t.labor.rate=v;});if(t.labor.method==='base_burden')field(costs,'Labor Burden (%)',prefix+'-burden',t.labor.burdenPercent,function(v){t.labor.burdenPercent=nullable(v);});}
        sourceFields(box,t.source,prefix+'-source');if(draft.inputs.trips.length>1||draft.inputs.logistics.length)button('Remove Trip',function(){draft.inputs.trips.splice(i,1);draft.inputs.loadBindings=draft.inputs.loadBindings.filter(function(b){return b.tripId!==t.lineId;});draft.inputs.logistics.forEach(function(l){if(l.tripId===t.lineId){l.tripId=null;l.basis='whole_job';}});invalidate();rerender('cdTravelAddTrip');},box);
      });
      if(draft.inputs.trips.length<12){var add=button('Add Trip',function(){draft.inputs.trips.push(trip());invalidate();rerender('cdTravelPurpose-'+(draft.inputs.trips.length-1));},form);add.id='cdTravelAddTrip';}
      var logistics=details(form,'Loading, Waiting And Other Logistics Costs','logistics');
      draft.inputs.logistics.forEach(function(l,i){var box=section(logistics,'Logistics Cost '+(i+1)),prefix='cdTravelLogistics-'+i;field(box,'Cost Description',prefix+'-label',l.label,function(v){l.label=v;}).required=true;field(box,'Cost Category',prefix+'-category',l.category,function(v){l.category=v;},null,[['mobilization','Mobilization'],['loading','Loading Or Unloading'],['waiting','Waiting'],['delivery','Delivery'],['tolls','Tolls'],['parking','Parking'],['permit','Permit'],['accommodation','Accommodation'],['access','Access']]);field(box,'Cost Applies',prefix+'-applies',String(l.applicable),function(v){l.applicable=v==='true';l.reason=l.applicable?null:'';l.tripId=null;l.quantity=l.applicable?'1':null;l.unit=l.applicable?'job':null;l.rate=null;l.basis='whole_job';invalidate();rerender(prefix+'-applies');},null,[['true','Yes'],['false','Not Applicable']]);if(l.applicable){field(box,'Quantity',prefix+'-quantity',l.quantity,function(v){l.quantity=nullable(v);});field(box,'Quantity Unit',prefix+'-unit',l.unit,function(v){l.unit=v;l.quantity=null;invalidate();rerender(prefix+'-quantity');},null,[['job','Job'],['trip','Trip'],['day','Day'],['hour','Hour'],['item','Item']]);amount(box,'Cost Per Quantity Unit',prefix+'-rate',l.rate,function(v){l.rate=v;});field(box,'Multiply This Quantity',prefix+'-basis',l.basis,function(v){l.basis=v;l.tripId=v==='whole_job'?null:draft.inputs.trips[0]&&draft.inputs.trips[0].lineId;invalidate();rerender(prefix+'-basis');},null,[['whole_job','Once For The Whole Job'],['per_trip','By The Number Of Trips'],['per_vehicle_trip','By Vehicle Trips']]);if(l.basis!=='whole_job')field(box,'Related Trip',prefix+'-trip',l.tripId,function(v){l.tripId=v;},null,draft.inputs.trips.map(function(t,j){return[t.lineId,t.purpose||'Trip '+(j+1)];}));}else field(box,'Why This Cost Does Not Apply',prefix+'-reason',l.reason,function(v){l.reason=v;}).required=true;sourceFields(box,l.source,prefix+'-source');button('Remove Logistics Cost',function(){draft.inputs.logistics.splice(i,1);invalidate();rerender('cdTravelAddLogistics');},box);});
      if(draft.inputs.logistics.length<12){var addLogistics=button('Add Logistics Cost',function(){draft.inputs.logistics.push({lineId:crypto.randomUUID(),label:'',category:'loading',applicable:true,reason:null,basis:'whole_job',tripId:null,quantity:'1',unit:'job',rate:null,source:emptySource()});invalidate();rerender('cdTravelLogistics-'+(draft.inputs.logistics.length-1)+'-label');},logistics);addLogistics.id='cdTravelAddLogistics';}
      var access=details(form,'Access Windows And Restrictions','access');draft.inputs.access.forEach(function(a,i){var box=section(access,'Access Information '+(i+1)),prefix='cdTravelAccess-'+i;field(box,'Access Description',prefix+'-label',a.label,function(v){a.label=v;}).required=true;field(box,'Reported Access',prefix+'-status',a.status,function(v){a.status=v;},null,[['unknown','Unknown'],['open','Open'],['closed','Closed']]);field(box,'Applies To This Job',prefix+'-applies',a.appliesToJob===null?'unknown':String(a.appliesToJob),function(v){a.appliesToJob=v==='unknown'?null:v==='true';},null,[['unknown','Unknown'],['true','Yes'],['false','No']]);['start','end'].forEach(function(k){field(box,k==='start'?'Window Starts (UTC)':'Window Ends (UTC)',prefix+'-'+k,a[k]?a[k].slice(0,16):'',function(v){a[k]=v?new Date(v+'Z').toISOString():null;},'datetime-local');});sourceFields(box,a.source,prefix+'-source');button('Remove Access Information',function(){draft.inputs.access.splice(i,1);invalidate();rerender('cdTravelAddAccess');},box);});if(draft.inputs.access.length<12){var addAccess=button('Add Access Information',function(){draft.inputs.access.push({lineId:crypto.randomUUID(),label:'',status:'unknown',start:null,end:null,appliesToJob:null,source:emptySource()});invalidate();rerender('cdTravelAccess-'+(draft.inputs.access.length-1)+'-label');},access);addAccess.id='cdTravelAddAccess';}
    }
    if(draft.action==='save'){
      var hauling=details(form,'Hauling Quantity And Capacity','hauling');para('Use measured or estimated processed output. Tree size, machine names and past jobs do not establish yield, payload or density.',hauling);
      draft.inputs.hauls.forEach(function(h,i){var box=section(hauling,'Haul Group '+(i+1)),prefix='cdTravelHaul-'+i;field(box,'Haul Description',prefix+'-label',h.label,function(v){h.label=v;}).required=true;field(box,'Material Being Hauled',prefix+'-material',h.material,function(v){h.material=v;}).required=true;field(box,'Material And Vehicle Group',prefix+'-homogeneous',String(h.homogeneous),function(v){h.homogeneous=v==='true';},null,[['true','Same Material And Capacity For Each Load'],['false','Mixed Materials Or Different Capacities']]);
        ['volume','mass'].forEach(function(k){var d=h[k],name=k==='volume'?'Volume':'Payload',group=details(box,name+' Basis',prefix+'-'+k);field(group,name+' Applies',prefix+'-'+k+'-applies',d.applicable===null?'unknown':String(d.applicable),function(v){d.applicable=v==='unknown'?null:v==='true';d.reason=d.applicable===false?'':null;if(d.applicable===false)d.output=d.retained=d.capacity=d.existing=null;invalidate();rerender(prefix+'-'+k+'-applies');},null,[['unknown','Unknown'],['true','Yes'],['false','Not Applicable']]);if(d.applicable===false)field(group,'Why '+name+' Does Not Apply',prefix+'-'+k+'-reason',d.reason,function(v){d.reason=v;}).required=true;else{field(group,name+' Unit',prefix+'-'+k+'-unit',d.unit,function(v){if(d.unit!==v){d.unit=v;d.output=d.retained=d.capacity=d.existing=null;(h.detail&&h.detail.orderedLoads||[]).forEach(function(load){load[k].quantity=load[k].capacity=load[k].existing=null;});invalidate();}rerender(prefix+'-'+k+'-output');},null,k==='volume'?[['yd3','Cubic Yards'],['m3','Cubic Metres']]:[['lb','Pounds'],['kg','Kilograms']]);[['output','New Processed Output'],['retained','Output Retained Onsite'],['capacity',k==='volume'?'Usable Volume Per Load':'Usable Payload Per Load'],['existing','Contents Already Loaded']].forEach(function(row){field(group,row[1],prefix+'-'+k+'-'+row[0],d[row[0]],function(v){d[row[0]]=nullable(v);});});}});
        field(box,'Existing Contents Belong To',prefix+'-owner',h.initialLoadOwner,function(v){h.initialLoadOwner=v;},null,[['unknown','Not Yet Known'],['this_job','This Job'],['other_job','Other Work']]);field(box,'Existing Contents And Disposal Responsibility',prefix+'-existingNote',h.initialLoadNote,function(v){h.initialLoadNote=v;}).required=true;sourceFields(box,h.source,prefix+'-source');
        if(!h.detail)h.detail={equipmentBasis:null,density:null,orderedLoads:[]};
        var equipmentChoices=(plans.sources.resourceChoices&&plans.sources.resourceChoices.equipment||[]).filter(function(e){return e.sourceCurrent;});var selectedEquipment=equipmentChoices.findIndex(function(e){return JSON.stringify(e.pin)===JSON.stringify(h.detail.equipmentBasis);});
        field(box,'Recorded Hauling Equipment',prefix+'-equipment',selectedEquipment<0?'':String(selectedEquipment),function(v){h.detail.equipmentBasis=v===''?null:JSON.parse(JSON.stringify(equipmentChoices[Number(v)].pin));},null,[['','Not Yet Selected']].concat(equipmentChoices.map(function(e,j){return[String(j),e.label];})));para('A saved configuration identifies the equipment. Capacity, condition and availability still need their own evidence.',box);
        var measured=details(box,'Density Or Separately Measured Loads',prefix+'-measured');
        field(measured,'Measurement Method',prefix+'-measurementMethod',h.detail.orderedLoads.length?'ordered':h.detail.density?'density':'direct',function(v){h.detail.density=v==='density'?{value:null,massUnit:h.mass.unit,volumeUnit:h.volume.unit,source:emptySource()}:null;h.detail.orderedLoads=[];if(v==='ordered'){h.homogeneous=false;h.detail.orderedLoads.push({loadId:crypto.randomUUID(),volume:{quantity:null,capacity:null,existing:null},mass:{quantity:null,capacity:null,existing:null},initialLoadOwner:'unknown',initialLoadNote:''});}invalidate();rerender(prefix+'-measurementMethod');},null,[['direct','Record Volume And Mass Separately'],['density','Use An Explicit Recorded Density'],['ordered','Measure Each Load Separately']]);
        if(h.detail.density){var density=h.detail.density;para('Use a source for this material and condition. Density does not establish the mass of contents already in the vehicle.',measured);field(measured,'Density',prefix+'-density',density.value,function(v){density.value=nullable(v);});field(measured,'Mass Unit In Density',prefix+'-densityMass',density.massUnit,function(v){density.massUnit=v;density.value=null;invalidate();rerender(prefix+'-density');},null,[['lb','Pounds'],['kg','Kilograms']]);field(measured,'Volume Unit In Density',prefix+'-densityVolume',density.volumeUnit,function(v){density.volumeUnit=v;density.value=null;invalidate();rerender(prefix+'-density');},null,[['yd3','Per Cubic Yard'],['m3','Per Cubic Metre']]);sourceFields(measured,density.source,prefix+'-densitySource');}
        h.detail.orderedLoads.forEach(function(load,j){var loadBox=section(measured,'Measured Load '+(j+1)),loadPrefix=prefix+'-load-'+j;['volume','mass'].forEach(function(k){if(h[k].applicable===false)return;var unit={yd3:'Cubic Yards',m3:'Cubic Metres',lb:'Pounds',kg:'Kilograms'}[h[k].unit];[['quantity','New Material'],['capacity','Usable Capacity'],['existing','Already Loaded']].forEach(function(row){field(loadBox,row[1]+' ('+unit+')',loadPrefix+'-'+k+'-'+row[0],load[k][row[0]],function(v){load[k][row[0]]=nullable(v);});});});field(loadBox,'Existing Contents Belong To',loadPrefix+'-owner',load.initialLoadOwner,function(v){load.initialLoadOwner=v;},null,[['unknown','Not Yet Known'],['this_job','This Job'],['other_job','Other Work']]);field(loadBox,'Existing Contents And Disposal Responsibility',loadPrefix+'-note',load.initialLoadNote,function(v){load.initialLoadNote=v;}).required=true;button('Remove Measured Load',function(){h.detail.orderedLoads.splice(j,1);invalidate();rerender(prefix+'-measurementMethod');},loadBox);});
        if(h.detail.orderedLoads.length&&h.detail.orderedLoads.length<12)button('Add Measured Load',function(){h.detail.orderedLoads.push({loadId:crypto.randomUUID(),volume:{quantity:null,capacity:null,existing:null},mass:{quantity:null,capacity:null,existing:null},initialLoadOwner:'unknown',initialLoadNote:''});invalidate();rerender(prefix+'-load-'+(h.detail.orderedLoads.length-1)+'-volume-quantity');},measured);
        var legs=details(box,'Disposal, Return And Final Legs',prefix+'-legs');para('Choose the one-way trips used for these loads. Their vehicle-trip counts must agree with the calculated loads. Enter a different final destination separately.',legs);
        ['outbound','return','final'].forEach(function(role){var b=draft.inputs.loadBindings.find(function(x){return x.groupId===h.lineId&&x.role===role;});field(legs,{outbound:'Outbound To Disposal',return:'Return Between Loads',final:'Final Destination Leg'}[role],prefix+'-'+role,b?b.tripId:'',function(v){draft.inputs.loadBindings=draft.inputs.loadBindings.filter(function(x){return !(x.groupId===h.lineId&&x.role===role);});if(v)draft.inputs.loadBindings.push({groupId:h.lineId,tripId:v,role:role,countBasis:role==='outbound'?'all_loads':role==='final'?'once':'except_last'});invalidate();rerender(prefix+'-'+role);},null,[['','Not Yet Recorded']].concat(draft.inputs.trips.map(function(t,j){return[t.lineId,t.purpose||'Trip '+(j+1)];})));if(b&&role==='return')field(legs,'Return Count',prefix+'-returnCount',b.countBasis,function(v){b.countBasis=v;},null,[['except_last','Return Between Loads Only'],['all_loads','Return After Every Load']]);});button('Remove Haul Group',function(){draft.inputs.hauls.splice(i,1);draft.inputs.loadBindings=draft.inputs.loadBindings.filter(function(b){return b.groupId!==h.lineId;});invalidate();rerender('cdTravelAddHaul');},box);
      });
      if(draft.inputs.hauls.length<12){var addHaul=button('Add Haul Group',function(){draft.inputs.hauls.push({lineId:crypto.randomUUID(),label:'',material:'',homogeneous:true,volume:{applicable:null,reason:null,unit:'yd3',output:null,retained:null,capacity:null,existing:null},mass:{applicable:null,reason:null,unit:'lb',output:null,retained:null,capacity:null,existing:null},initialLoadOwner:'unknown',initialLoadNote:'',source:emptySource()});invalidate();rerender('cdTravelHaul-'+(draft.inputs.hauls.length-1)+'-label');},hauling);addHaul.id='cdTravelAddHaul';}
      var timing=details(form,'Driver, Equipment And Work Stages','stages');para('Record who or what a stage needs and which earlier work must finish. Declared resources do not establish qualifications or actual availability. Elapsed time is separate from worker-hours and cost.',timing);
      if(!draft.inputs.stagePlan)button('Add A Declared Stage Plan',function(){draft.inputs.stagePlan={resources:[],stages:[]};invalidate();rerender('cdTravelAddResource');},timing);
      else{var stagePlan=draft.inputs.stagePlan;
        stagePlan.resources.forEach(function(r,i){var box=section(timing,'Resource '+(i+1)),prefix='cdTravelResource-'+i;field(box,'Resource Description',prefix+'-label',r.label,function(v){r.label=v;}).required=true;field(box,'Resource Type',prefix+'-kind',r.kind,function(v){r.kind=v;r.binding=null;invalidate();rerender(prefix+'-kind');},null,[['person','Person'],['equipment','Equipment Or Vehicle']]);var component=r.kind==='person'?'labor':'equipment',resourceChoices=(plans.sources.resourceChoices&&plans.sources.resourceChoices[component]||[]).filter(function(e){return component==='labor'||e.sourceCurrent;}),selectedResource=resourceChoices.findIndex(function(e){return r.binding&&JSON.stringify(e.pin)===JSON.stringify(r.binding.reference);});field(box,component==='labor'?'Task Included In This Estimate':'Recorded Equipment',prefix+'-basis',selectedResource<0?'':String(selectedResource),function(v){r.binding=v===''?null:{component:component,reference:JSON.parse(JSON.stringify(resourceChoices[Number(v)].pin)),position:component==='labor'?1:null};invalidate();rerender(prefix+'-basis');},null,[['','Not Yet Selected']].concat(resourceChoices.map(function(e,j){return[String(j),e.label];})));if(r.binding&&component==='labor'){field(box,'Declared Position Within This Task Crew',prefix+'-position',r.binding.position,function(v){r.binding.position=number(v);});var task=resourceChoices[selectedResource];para(task&&task.people!==null?task.people+' People Recorded For This Task. Positions identify planned crew allocation, not employee qualification.':'This task has no recorded headcount. Who remains onsite is still unknown.',box);}field(box,'Availability For This Declared Plan',prefix+'-available',r.available===null?'unknown':String(r.available),function(v){r.available=v==='unknown'?null:v==='true';},null,[['unknown','Unknown'],['true','Reported Available'],['false','Reported Unavailable']]);sourceFields(box,r.source,prefix+'-source');button('Remove Resource',function(){stagePlan.resources.splice(i,1);stagePlan.stages.forEach(function(s){s.resourceIds=s.resourceIds.filter(function(id){return id!==r.resourceId;});});invalidate();rerender('cdTravelAddResource');},box);});
        if(stagePlan.resources.length<12){var addResource=button('Add Resource',function(){stagePlan.resources.push({resourceId:crypto.randomUUID(),label:'',kind:'person',available:null,source:emptySource()});invalidate();rerender('cdTravelResource-'+(stagePlan.resources.length-1)+'-label');},timing);addResource.id='cdTravelAddResource';}
        stagePlan.stages.forEach(function(stage,i){var box=section(timing,'Work Stage '+(i+1)),prefix='cdTravelStage-'+i;field(box,'Stage Description',prefix+'-label',stage.label,function(v){stage.label=v;}).required=true;field(box,'Stage Type',prefix+'-kind',stage.kind,function(v){stage.kind=v;},null,[['travel','Travel'],['loading','Loading'],['queue','Queue Or Waiting'],['unloading','Unloading'],['onsite','Onsite Work'],['other','Other Declared Work']]);field(box,'Where Required People And Equipment Will Be',prefix+'-presence',stage.presence||'unknown',function(v){stage.presence=v;},null,[['unknown','Not Yet Known'],['onsite','Onsite'],['away','Away From The Job']]);field(box,'Duration',prefix+'-duration',stage.duration,function(v){stage.duration=nullable(v);});field(box,'Duration Unit',prefix+'-unit',stage.unit,function(v){stage.unit=v;stage.duration=null;invalidate();rerender(prefix+'-duration');},null,[['min','Minutes'],['hour','Hours']]);
          function choices(title,rows,values,idKey){var group=details(box,title,prefix+'-'+idKey);rows.forEach(function(row){var label=el('label',null,group);label.className='drawer-decision-confirmation';var c=el('input',null,label);c.type='checkbox';c.checked=values.indexOf(row[idKey])>=0;c.style.cssText='width:20px;height:20px;min-height:0;padding:0;';el('span',row.label||'Unnamed '+(idKey==='stageId'?'Stage':'Resource'),label);c.onchange=function(){var index=values.indexOf(row[idKey]);if(c.checked&&index<0)values.push(row[idKey]);else if(!c.checked&&index>=0)values.splice(index,1);invalidate();};});}
          choices('Required Resources',stagePlan.resources,stage.resourceIds,'resourceId');choices('Earlier Stages That Must Finish First',stagePlan.stages.slice(0,i),stage.dependencies,'stageId');sourceFields(box,stage.source,prefix+'-source');button('Remove Work Stage',function(){stagePlan.stages.splice(i,1);stagePlan.stages.forEach(function(s){s.dependencies=s.dependencies.filter(function(id){return id!==stage.stageId;});});invalidate();rerender('cdTravelAddStage');},box);
        });
        if(stagePlan.stages.length<12){var addStage=button('Add Work Stage',function(){stagePlan.stages.push({stageId:crypto.randomUUID(),label:'',kind:'onsite',duration:null,unit:'min',dependencies:[],resourceIds:[],source:emptySource()});invalidate();rerender('cdTravelStage-'+(stagePlan.stages.length-1)+'-label');},timing);addStage.id='cdTravelAddStage';}button('Remove Declared Stage Plan',function(){draft.inputs.stagePlan=null;invalidate();rerender();},timing);
      }
    }
    field(form,'Reason For This Plan','cdTravelReason',draft.reason,function(v){draft.reason=v;}).required=true;
    var results=el('div',null,form);results.id='cdTravelResult';
    function showResult(){results.replaceChildren();if(!draft.result)return;para(draft.result.complete?'Travel Cost: '+decisionMoney(draft.result.total,review.currency):'Travel Cost Incomplete — Known Cost Subtotal: '+decisionMoney(draft.result.knownCostSubtotal,review.currency),results);if(draft.result.outsideCoverageRequired&&draft.result.outsideCoverageRequired.length)para('Other vehicle costs still require an exact equipment allocation when applying this plan to the estimate.',results);draft.result.trips.forEach(function(t){para(t.purpose+': '+(t.complete?decisionMoney(t.total,review.currency):'Needs '+t.missing.join(' And ')),results);});if(draft.result.hauling.groups.length)draft.result.hauling.groups.forEach(function(g,i){para(draft.inputs.hauls[i].label+': '+(g.additionalLoads===null?'Load Count Unknown':g.additionalLoads+' Additional Loads'),results);});renderTravelResourceReview(results,draft.result.resourceReview,draft.result.stagePlan);if(draft.assessment.cautions.length)para('Some dates, locations or travel measurements need review. Explain the assumptions you are using below.',results);}
    showResult();var explanation=field(form,'Source Assumptions To Confirm','cdTravelExplanation',draft.explanation,function(v){draft.explanation=v;});explanation.oninput=explanation.onchange=function(){draft.explanation=explanation.value;draft.confirmed=false;draft.request=null;if(confirm)confirm.checked=false;};
    var label=el('label',null,form);label.className='drawer-decision-confirmation';label.style.cssText='display:flex;align-items:flex-start;gap:0.65rem;margin:1rem 0;';var confirm=el('input',null,label);confirm.id='cdTravelConfirm';confirm.type='checkbox';confirm.checked=draft.confirmed;confirm.style.cssText='flex:0 0 auto;margin-top:0.25rem;width:1rem;height:1rem;min-height:0;padding:0;';el('span',draft.action==='save'?'I reviewed the travel quantities, costs and source limitations. Save this plan without changing the estimate, price or schedule.':'Withdraw this travel plan and retain its saved history.',label);confirm.onchange=function(){draft.confirmed=confirm.checked;draft.request=null;};
    var status=para(draft.changed?'The review changed. Calculate again and confirm.':'',form);status.id='cdTravelStatus';status.setAttribute('role','status');status.tabIndex=-1;
    function body(){if(draft.result)draft.inputs.assessment=Object.assign({},draft.assessment,{acknowledged:draft.confirmed,explanation:draft.explanation});return{action:draft.action,expectedRevision:current?current.revision:0,expectedDigest:current?current.digest:'none',sourcePins:review.pins,expectedDecisionRevision:plans.decisionBasis.revision,expectedDecisionDigest:plans.decisionBasis.digest,inputs:draft.action==='save'?draft.inputs:null,currency:review.currency,reason:draft.reason,confirmed:draft.confirmed,confirmationVersion:'estimate-travel-plan-v1'};}
    function send(preview){if(!form.reportValidity()||!reviewPinsMatch(review,_currentData&&_currentData.canonical))return;if(!preview&&(!draft.confirmed||draft.action==='save'&&!draft.result)){status.textContent=draft.action==='withdraw'?'Review and confirm the withdrawal.':'Calculate travel costs, review the result and confirm before saving.';status.focus();return;}var generation=_openSequence,attempt=preview?{body:body()}:draft.request||(draft.request={body:JSON.parse(JSON.stringify(body())),key:crypto.randomUUID(),demoRevision:review.demoWorkspaceRevision}),headers={'Content-Type':'application/json'};if(!preview)headers['Idempotency-Key']=attempt.key;if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(preview?review.demoWorkspaceRevision:attempt.demoRevision);var disabled=Array.prototype.map.call(form.elements,function(e){var value=e.disabled;e.disabled=true;return value;});status.textContent=preview?'Calculating travel cost.':'Saving travel plan.';
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/travel-plan-preview':'/travel-plans'),{method:'POST',headers:headers,body:JSON.stringify(attempt.body)}).then(function(response){return response.json().catch(function(){return{};}).then(function(b){if(!response.ok)throw{status:response.status,category:b.error&&b.error.category};return b;});}).then(function(b){if(generation!==_openSequence||_travelPlanDraft!==draft||_estimateReview!==review)return;if(preview){if(!b.success||JSON.stringify(b.data.sourcePins)!==JSON.stringify(review.pins)||!b.data.decisionBasis||b.data.decisionBasis.revision!==plans.decisionBasis.revision||b.data.decisionBasis.digest!==plans.decisionBasis.digest)throw{status:409};draft.result=b.data.result;draft.assessment=b.data.assessment;draft.confirmed=false;confirm.checked=false;draft.request=null;showResult();status.textContent='Review the calculation and source assumptions, then confirm to save.';}else{_travelPlanDraft=null;refreshEstimateReview('travel-saved');}}).catch(function(e){if(generation!==_openSequence||_travelPlanDraft!==draft||_estimateReview!==review)return;var paused=e.status===503&&e.category==='travel_paused',known=[400,401,403,404,409,410,413,429].indexOf(e.status)>=0||paused;status.textContent=e.status===400?'Check the trip quantities, cost basis and source assumptions. Calculate again.':e.status===401?'Sign in again before saving.':e.status===403?'Your current account cannot save travel plans.':e.status===404?'This estimate is unavailable. Choose a current estimate.':e.status===409?'The estimate, travel plan or source information changed. Refresh, calculate again and confirm.':e.status===410?'This demo session expired. Refresh to start again.':e.status===413?'Shorten the travel entries and source notes before trying again.':e.status===429?(e.category==='travel_history_limit'?'This demo has reached its travel history limit. Saved plans remain available. To start over, deliberately reset the demo; this removes its saved work and history.':'Saving is currently limited. Check saved history before trying again. If the limit continues, return later.'):paused?'New travel plans are paused. Refresh to check saved history.':preview?'Travel costs could not be calculated. Try calculating again.':'The save result is unconfirmed. Retry this same attempt without changing entries, or refresh to check saved history.';if(known||preview){draft.confirmed=false;confirm.checked=false;draft.result=null;draft.assessment=null;draft.request=null;results.replaceChildren();}}).finally(function(){if(generation===_openSequence&&_travelPlanDraft===draft&&_estimateReview===review){Array.prototype.forEach.call(form.elements,function(e,i){e.disabled=disabled[i];});status.focus();}});
    }
    var actions=el('div',null,form);actions.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.75rem;margin-top:0.75rem;';if(draft.action==='save')button('Calculate Travel Cost',function(){send(true);},actions);button(draft.action==='save'?'Save Travel Plan':'Confirm Travel Withdrawal',function(){send(false);},actions);button('Cancel Travel Plan',function(){_travelPlanDraft=null;rerender('cdTravelStart');},actions);
  }

  function renderPricingPolicyResult(result,target,currency) {
    function p(value){var n=document.createElement('p');n.textContent=value;target.appendChild(n);}
    if(!result){p('Saved policy details are unavailable.');return;}
    function value(x){return x===null||x===undefined?'Not Yet Known':(String(x).charAt(0)==='-'?'−':'')+decisionMoney(String(x).replace(/^−|^-/,'') ,currency);}
    var dl=document.createElement('dl');dl.className='drawer-policy-facts';target.appendChild(dl);
    function row(label,text){var group=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=text;group.append(dt,dd);dl.appendChild(group);}
    row('Policy Threshold',value(result.threshold));
    [['Proposed Charge',result.proposed],['Reviewed Price',result.reviewed]].forEach(function(item){var r=item[1];if(!r){row(item[0],'Not Recorded');return;}row(item[0],value(r.price));row(item[0]+' — Difference From Threshold',value(r.thresholdDifference));if(result.threshold===null&&r.fixedFloorDifference!==null)row(item[0]+' — Partial Minimum Check',value(r.fixedFloorDifference));});
    var details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Cost And Rate Details';details.appendChild(summary);target.appendChild(details);dl=document.createElement('dl');dl.className='drawer-policy-facts';details.appendChild(dl);
    [['Recorded Direct Costs',result.directCosts],['Gross Overhead',result.overhead.gross],['Already Included Overhead',result.overhead.alreadyIncluded],['Additional Overhead',result.overhead.incremental],['Additional Contingency',result.allowance],['Costs With Allowance',result.policyCost],['Calculated Price Threshold',result.calculatedThreshold],['Minimum Price',result.minimum]].forEach(function(r){row(r[0],value(r[1]));});
    [['Proposed Charge',result.proposed],['Reviewed Price',result.reviewed]].forEach(function(item){var r=item[1];if(!r)return;row(item[0]+' — After Costs And Allowance',value(r.remaining));[['Markup',r.achievedMarkup],['Margin',r.achievedMargin]].forEach(function(x){row(item[0]+' — '+x[0],x[1]?(x[1].approximate?'Approximately ':'')+x[1].value+'%':'Not Available');});});
    var explanation=document.createElement('p');explanation.textContent='Markup needs known, nonzero costs; margin needs a known, nonzero price.';details.appendChild(explanation);
    p('Recorded costs and declared allowances only. This is not a net-profit forecast or price approval.');
  }
  var _pricingPolicyDraft=null;
  function renderPricingPolicy(review,parent) {
    restoreReviewActions();queueMicrotask(positionPricingReviewActions);var existing=$('cdPolicyPlan');if(existing)existing.remove();
    var root=document.createElement('details');root.id='cdPolicyPlan';root.className='drawer-labor-plan';parent.appendChild(root);
    function el(tag,text,target){var n=document.createElement(tag);if(text)n.textContent=text;(target||root).appendChild(n);return n;}
    el('summary','Pricing Policy');var plans=review.pricingPolicies;
    if(!plans||plans.contract!=='estimate-pricing-policy-v1'||JSON.stringify(plans.sourcePins)!==JSON.stringify(review.pins)||plans.simulated!==review.simulated){el('p','Pricing policies are unavailable. Refresh this estimate.');return;}
    function resultView(result,target){renderPricingPolicyResult(result,target,review.currency);}
    function pricingCautions(a,target){if(!a||!a.cautions)return;a.cautions.forEach(function(c){var names={date_unknown:'Source Date Not Recorded',freshness_unknown:'End Date Not Known',not_yet_effective:'Source Is Not Yet Effective',expired:'Source Has Expired'};el('p',c.reasons.map(function(r){return names[r]||'Review Source';}).join('; '),target);});}
    function show(plan,target){if(plan.action==='withdraw'){el('p','This policy was withdrawn. Saved history remains available.',target);return;}el('p',plan.current?'Saved policy comparison — it does not approve the price.':'Earlier Policy — Review Current Pricing And Price Approval Before Using It.',target);resultView(plan===plans.current&&plan.commercialApprovalCurrent?review.pricingPolicyCheck.result:plan.result,target);pricingCautions(plan.currentAssessment,target);}
    if(plans.simulated)el('p','Simulated Pricing Policy — No Customer Price Is Approved Or Sent.');
    if(plans.current)show(plans.current,root);else el('p','Compare a saved pricing proposal with your cost and minimum-price policy.');
    if(plans.history.length){var h=el('details');el('summary','Policy History',h);plans.history.forEach(function(p){var d=el('details',null,h);el('summary',(p.action==='save'?'Saved Policy':'Withdrawn Policy')+' — '+(p.actorName||'Company Reviewer'),d);show(p,d);});}
    function button(label,fn,target,id){var b=el('button',label,target);b.type='button';b.className='btn btn-secondary';if(id)b.id=id;b.onclick=fn;return b;}
    if(!plans.canMutate){el('p',plans.mutationsPaused?'New pricing policies are paused. Refresh to check saved history.':'Select the current estimate with an authorized account to review pricing.');return;}
    var basisKey=JSON.stringify([review.pins,plans.decisionBasis,plans.current&&plans.current.digest,plans.sources.digest]);
    if(_pricingPolicyDraft&&_pricingPolicyDraft.basisKey!==basisKey){_pricingPolicyDraft.result=null;_pricingPolicyDraft.request=null;_pricingPolicyDraft.confirmed=false;_pricingPolicyDraft.basisKey=basisKey;_pricingPolicyDraft.changed=true;}
    function source(){return{kind:'owner_estimate',referenceId:null,digest:null,note:'',effectiveOn:null,endsOn:null};}
    function empty(){return{serviceKey:plans.serviceKey,method:'unknown',percent:null,contingency:{method:'unknown',amount:null,percent:null,coverage:{status:'unknown',explanation:''}},minimum:{method:'none',amount:null},source:source()};}
    function rerender(id){var opens={};root.querySelectorAll('details[data-policy-section]').forEach(function(d){opens[d.dataset.policySection]=d.open;});renderPricingPolicy(review,parent);var mounted=$('cdPolicyPlan');if(mounted){mounted.open=true;mounted.querySelectorAll('details[data-policy-section]').forEach(function(d){if(Object.prototype.hasOwnProperty.call(opens,d.dataset.policySection))d.open=opens[d.dataset.policySection];});var focus=id&&$(id);if(focus)focus.focus();}}
    function start(action){_pricingPolicyDraft={action:action,inputs:plans.current&&plans.current.action==='save'&&plans.current.inputs?JSON.parse(JSON.stringify(plans.current.inputs)):empty(),reason:'',confirmed:false,result:null,request:null,basisKey:basisKey};_pricingPolicyDraft.inputs.serviceKey=plans.serviceKey;rerender(action==='withdraw'?'cdPolicyReason':'cdPolicyMethod');}
    if(!_pricingPolicyDraft){if(plans.sources.pricingPin)button(plans.current&&plans.current.action==='save'?'Revise Pricing Policy':'Add Pricing Policy',function(){start('save');},root,'cdPolicyStart');if(plans.current&&plans.current.action==='save')button('Withdraw Pricing Policy',function(){start('withdraw');},root,'cdPolicyWithdraw');if(!plans.sources.pricingPin)el('p','Save a current pricing plan before adding or revising this policy. You can still withdraw an existing policy.');return;}
    root.open=true;var draft=_pricingPolicyDraft,generation=_openSequence,form=el('form'),status=el('p',draft.changed?'The estimate or sources changed. Calculate again and review before confirming.':'',form);status.id='cdPolicyStatus';status.tabIndex=-1;status.setAttribute('role','status');
    function invalidate(){draft.result=null;draft.request=null;draft.confirmed=false;if(confirm)confirm.checked=false;if(results)results.replaceChildren();}
    function field(target,label,id,value,set,options){var group=el('label',null,target);group.htmlFor=id;el('span',label,group);var n=el(options?'select':'input',null,group);n.id=id;if(options)options.forEach(function(o){var option=el('option',o[1],n);option.value=o[0];});n.value=value===null?'':value;n.addEventListener(options?'change':'input',function(){invalidate();set(n.value);});return n;}
    function nullable(v){return v.trim()===''?null:v.trim();}
    function money(v){v=nullable(v);return v!==null&&/^\d+(\.\d{1,2})?$/.test(v)?v.split('.')[0]+'.'+((v.split('.')[1]||'')+'00').slice(0,2):v;}
    function details(target,label,id){var d=el('details',null,target);d.dataset.policySection=id;el('summary',label,d);return d;}
    function sourceFields(target,value,id){var box=details(target,'Source And Dates',id);var options=[['owner_estimate','My Estimate']].concat(plans.sources.references.map(function(r){return[r.kind+':'+r.referenceId,r.label];}));field(box,'Source',id+'-kind',value.kind==='owner_estimate'?'owner_estimate':value.kind+':'+value.referenceId,function(v){var r=plans.sources.references.find(function(x){return x.kind+':'+x.referenceId===v;});value.kind=r?r.kind:'owner_estimate';value.referenceId=r?r.referenceId:null;value.digest=r?r.digest:null;rerender(id+'-kind');},options);field(box,'Source Note',id+'-note',value.note,function(v){value.note=v;});field(box,'Effective Date',id+'-effective',value.effectiveOn,function(v){value.effectiveOn=nullable(v);}).type='date';field(box,'Known End Date',id+'-end',value.endsOn,function(v){value.endsOn=nullable(v);}).type='date';el('p','Leave unknown dates blank. A saved reference does not verify a selling price.',box);}
    if(draft.action==='save'){
      var v=draft.inputs,c=v.contingency,m=v.minimum;
      el('p','Markup is based on costs; margin is based on the price.',form);
      field(form,'Pricing Method','cdPolicyMethod',v.method,function(x){v.method=x;v.percent=null;rerender('cdPolicyMethod');},[['unknown','Not Yet Chosen'],['markup','Markup On Costs'],['target_margin','Target Margin On Price']]);
      if(v.method!=='unknown')field(form,v.method==='markup'?'Markup (%)':'Target Margin (%)','cdPolicyPercent',v.percent,function(x){v.percent=money(x);});
      var box=details(form,'Additional Contingency','allowance');
      field(box,'Allowance Method','cdPolicyAllowance',c.method,function(x){c.method=x;c.amount=null;c.percent=null;rerender('cdPolicyAllowance');},[['unknown','Not Yet Known'],['none','No Additional Allowance'],['fixed','Fixed Amount'],['percent','Percentage Of Costs And Overhead']]);
      if(c.method==='fixed')field(box,'Additional Amount','cdPolicyAmount',c.amount,function(x){c.amount=money(x);});
      if(c.method==='percent')field(box,'Allowance (%)','cdPolicyAllowancePercent',c.percent,function(x){c.percent=money(x);});
      el('p','Include only additional uncertainty. Do not repeat expenses already in the recorded costs or overhead. This is your declaration, not a verified expense split.',box);
      field(box,'Expense Coverage','cdPolicyCoverage',c.coverage.status,function(x){c.coverage.status=x;rerender('cdPolicyCoverage');},[['unknown','Not Yet Reviewed'],['declared_separate','Reviewed As Additional Only']]);
      field(box,'What This Allowance Covers','cdPolicyExplanation',c.coverage.explanation,function(x){c.coverage.explanation=x;});
      field(form,'Minimum Price','cdPolicyMinimum',m.method,function(x){m.method=x;m.amount=null;rerender('cdPolicyMinimum');},[['none','No Separate Minimum'],['fixed','Fixed Minimum']]);
      if(m.method==='fixed')field(form,'Minimum Amount','cdPolicyFloor',m.amount,function(x){m.amount=money(x);});
      sourceFields(form,v.source,'cdPolicySource');
    }
    field(form,'Reason For This Change','cdPolicyReason',draft.reason,function(v){draft.reason=v;}).required=true;
    var results=el('div',null,form);if(draft.result){resultView(draft.result,results);pricingCautions(draft.assessment,results,draft.inputs);}
    var label=el('label',null,form);label.className='drawer-decision-confirmation';var confirm=el('input',null,label);confirm.type='checkbox';confirm.id='cdPolicyConfirm';confirm.checked=draft.confirmed;el('span',draft.action==='withdraw'?'I reviewed withdrawing this policy. Saved history and the approved price remain unchanged.':'I reviewed the policy, additional-only allowance, minimum and source limitations. This does not approve or send a customer price.',label);confirm.onchange=function(){draft.confirmed=confirm.checked;};
    var actions=el('div',null,form);actions.className='drawer-review-actions';if(draft.action==='save')button('Calculate Policy',function(){send(true);},actions,'cdPolicyCalculate');var save=el('button',draft.action==='withdraw'?'Confirm Withdrawal':'Save Pricing Policy',actions);save.type='submit';save.className='btn btn-primary';save.id='cdPolicySave';actions.id='cdPolicyActions';bindReviewActions(root,actions);button('Cancel',function(){_pricingPolicyDraft=null;rerender('cdPolicyStart');},actions,'cdPolicyCancel');
    form.onsubmit=function(e){e.preventDefault();if(!draft.confirmed||draft.action==='save'&&!draft.result){status.textContent=draft.action==='withdraw'?'Review and confirm the withdrawal before saving.':'Calculate the policy, then review and confirm it.';status.focus();return;}send(false);};
    function send(preview){if(!form.reportValidity())return;var attempt=!preview&&draft.request;if(!attempt){attempt={key:crypto.randomUUID(),workspaceRevision:review.demoWorkspaceRevision,body:{action:draft.action,expectedRevision:plans.current?plans.current.revision:0,expectedDigest:plans.current?plans.current.digest:'none',sourcePins:review.pins,expectedDecisionRevision:plans.decisionBasis.revision,expectedDecisionDigest:plans.decisionBasis.digest,inputs:draft.action==='withdraw'?null:JSON.parse(JSON.stringify(draft.inputs)),currency:review.currency,reason:draft.reason,confirmed:true,confirmationVersion:plans.contract,evidenceDigest:draft.evidenceDigest||plans.sources.digest,pricingPin:plans.sources.pricingPin}};if(!preview)draft.request=attempt;}
      var headers={'Content-Type':'application/json','Idempotency-Key':attempt.key};if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(attempt.workspaceRevision);var disabled=Array.prototype.map.call(form.elements,function(x){var d=x.disabled;x.disabled=true;return d;});status.textContent=preview?'Calculating Policy…':'Saving Pricing Policy…';
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/pricing-policy-preview':'/pricing-policies'),{method:'POST',headers:headers,body:JSON.stringify(attempt.body)}).then(function(response){return response.json().catch(function(){return{};}).then(function(b){if(!response.ok)throw{status:response.status,category:b.error&&b.error.category};return b;});}).then(function(b){if(generation!==_openSequence||draft!==_pricingPolicyDraft||review!==_estimateReview)return;if(preview){if(!b.success||JSON.stringify(b.data.sourcePins)!==JSON.stringify(review.pins)||!b.data.decisionBasis||b.data.decisionBasis.revision!==plans.decisionBasis.revision||b.data.decisionBasis.digest!==plans.decisionBasis.digest)throw{status:409};draft.result=b.data.result;draft.assessment=b.data.assessment;draft.evidenceDigest=b.data.evidenceDigest;draft.request=null;draft.confirmed=false;confirm.checked=false;results.replaceChildren();resultView(draft.result,results);pricingCautions(draft.assessment,results,draft.inputs);status.textContent='Review the policy amounts and source dates, including any unknowns, then confirm to save.';}else{_pricingPolicyDraft=null;refreshEstimateReview('pricing-saved');}}).catch(function(e){if(generation!==_openSequence||draft!==_pricingPolicyDraft||review!==_estimateReview)return;var paused=e.status===503&&e.category==='pricing_policy_paused',known=[400,401,403,404,409,410,413,429].indexOf(e.status)>=0||paused;status.textContent=e.status===400?'Check the policy percentage, additional-only allowance and minimum. Calculate again.':e.status===401?'Sign in again before saving.':e.status===403?'Your current account cannot save pricing policies.':e.status===404?'This estimate is unavailable. Choose a current estimate.':e.status===409?'The estimate, proposal or sources changed. Refresh, calculate again and confirm.':e.status===410?'This demo session expired. Refresh to start again.':e.status===413?'Shorten the pricing entries and source notes before trying again.':e.status===429?(e.category==='pricing_policy_history_limit'?'This demo has reached its pricing history limit. Saved history remains available. Deliberately resetting removes its saved practice work.':'Saving is currently limited. Check saved history and try later.'):paused?'New pricing policies are paused. Refresh to check saved history.':preview?'Pricing could not be calculated. Try calculating again.':'The save result is unconfirmed. Retry this same attempt without changing entries, or refresh to check saved history.';if(known||preview)invalidate();}).finally(function(){if(generation===_openSequence&&draft===_pricingPolicyDraft&&review===_estimateReview){Array.prototype.forEach.call(form.elements,function(x,i){x.disabled=disabled[i];});status.focus();}});
    }
  }
  var _pricingPlanDraft=null;
  function renderPricingPlan(review,parent) {
    restoreReviewActions();queueMicrotask(positionPricingReviewActions);var existing=$('cdPricingPlan');if(existing)existing.remove();
    var root=document.createElement('details');root.id='cdPricingPlan';root.className='drawer-labor-plan';parent.appendChild(root);
    function el(tag,text,target){var n=document.createElement(tag);if(text)n.textContent=text;(target||root).appendChild(n);return n;}
    el('summary','Pricing Plan');var plans=review.pricingPlans;
    if(!plans||plans.contract!=='estimate-pricing-plan-v1'||JSON.stringify(plans.sourcePins)!==JSON.stringify(review.pins)||plans.simulated!==review.simulated){el('p','Pricing plans are unavailable. Refresh this estimate.');return;}
    function resultView(result,target){if(!result){el('p','Saved source details are unavailable.',target);return;}el('p','Proposed Before-Tax Charge: '+(result.proposedBeforeTax===null?'Not Yet Complete':decisionMoney(result.proposedBeforeTax,review.currency)),target);result.lines.forEach(function(l){el('p',l.label+': '+(l.amount===null?'Not Yet Known':decisionMoney(l.amount,review.currency))+(l.includedIn?' — Included In Package':''),target);});if(result.payments.length){el('p','Proposed Payment Timing — These Amounts Are Part Of The Charge, Not Extra Fees.',target);result.payments.forEach(function(p){el('p',p.label+': '+(p.amount===null?'Not Yet Calculated':decisionMoney(p.amount,review.currency)),target);});}el('p','Gross Allocated Overhead: '+(result.overhead.gross===null?'Not Yet Known':decisionMoney(result.overhead.gross,review.currency)),target);el('p','Already Included In Recorded Costs: '+(result.overhead.alreadyIncluded===null?'Not Yet Resolved':decisionMoney(result.overhead.alreadyIncluded,review.currency)),target);el('p','Additional Overhead: '+(result.overhead.incremental===null?'Review The Allocation And Included Costs':decisionMoney(result.overhead.incremental,review.currency)),target);el('p','Recorded Costs With This Allocation: '+(result.costWithOverhead===null?'Incomplete':decisionMoney(result.costWithOverhead,review.currency)),target);}
    function pricingCautions(a,target,inputs){if(!a||!a.cautions)return;a.cautions.forEach(function(c){var names={date_unknown:'Source Date Not Recorded',freshness_unknown:'End Date Not Known',not_yet_effective:'Source Is Not Yet Effective',expired:'Source Has Expired'};el('p',(inputs&&inputs.lines[c.index]?inputs.lines[c.index].label+' Source':'Overhead Source')+': '+c.reasons.map(function(r){return names[r]||'Review Source';}).join('; '),target);});}
    function show(plan,target){if(plan.action==='withdraw'){el('p','This pricing proposal was withdrawn. Saved history remains available.',target);return;}el('p',plan.sourceBasisCurrent?'Saved proposal. Review before using this price.':'Proposal For An Earlier Estimate — Recalculate Before Using It.',target);resultView(plan.result,target);pricingCautions(plan.currentAssessment,target,plan.inputs);}
    if(plans.simulated)el('p','Simulated Pricing Practice — No Invoice Or Payment Is Created.');
    if(plans.current)show(plans.current,root);else el('p','Describe the proposed customer charge and office costs when known. This does not change the reviewed price.');
    if(plans.history.length){var h=el('details');el('summary','Pricing History',h);plans.history.forEach(function(p){var d=el('details',null,h);el('summary',(p.action==='save'?'Saved Proposal':'Withdrawn Proposal')+' — '+(p.actorName||'Company Reviewer'),d);show(p,d);});}
    function button(label,fn,target,id){var b=el('button',label,target);b.type='button';b.className='btn btn-secondary';if(id)b.id=id;b.onclick=fn;return b;}
    if(!plans.canMutate){el('p',plans.mutationsPaused?'New pricing plans are paused. Refresh to check saved history.':'Select the current estimate with an authorized account to review pricing.');return;}
    var basisKey=JSON.stringify([review.pins,plans.decisionBasis,plans.current&&plans.current.digest,plans.sources.digest]);
    if(_pricingPlanDraft&&_pricingPlanDraft.basisKey!==basisKey){_pricingPlanDraft.result=null;_pricingPlanDraft.request=null;_pricingPlanDraft.confirmed=false;_pricingPlanDraft.basisKey=basisKey;_pricingPlanDraft.changed=true;}
    function source(){return{kind:'owner_estimate',referenceId:null,digest:null,note:'',effectiveOn:null,endsOn:null};}
    function line(){return{lineId:crypto.randomUUID(),label:'',kind:'fixed',quantity:null,unit:null,rate:null,amount:null,scope:'',includes:[],period:null,source:source()};}
    function empty(){return{serviceKey:plans.serviceKey,lines:[line()],payments:{mode:'none',balanceId:null,stages:[]},overhead:{method:'unknown',amount:null,percent:null,period:null,source:source(),coverage:{status:'unknown',explanation:'',included:[]}}};}
    function rerender(id){var opens={};root.querySelectorAll('details[data-pricing-section]').forEach(function(d){opens[d.dataset.pricingSection]=d.open;});renderPricingPlan(review,parent);var mounted=$('cdPricingPlan');if(mounted){mounted.open=true;mounted.querySelectorAll('details[data-pricing-section]').forEach(function(d){if(Object.prototype.hasOwnProperty.call(opens,d.dataset.pricingSection))d.open=opens[d.dataset.pricingSection];});var focus=id&&$(id);if(focus)focus.focus();}}
    function start(action){_pricingPlanDraft={action:action,inputs:plans.current&&plans.current.action==='save'&&plans.current.inputs?JSON.parse(JSON.stringify(plans.current.inputs)):empty(),reason:'',confirmed:false,result:null,request:null,basisKey:basisKey};_pricingPlanDraft.inputs.serviceKey=plans.serviceKey;rerender(action==='withdraw'?'cdPricingReason':'cdPricingLine-0-label');}
    if(!_pricingPlanDraft){button(plans.current&&plans.current.action==='save'?'Revise Pricing Plan':'Add Pricing Plan',function(){start('save');},root,'cdPricingStart');if(plans.current&&plans.current.action==='save')button('Withdraw Pricing Plan',function(){start('withdraw');},root,'cdPricingWithdraw');return;}
    root.open=true;var draft=_pricingPlanDraft,generation=_openSequence,form=el('form'),status=el('p',draft.changed?'The estimate or sources changed. Calculate again and review before confirming.':'',form);status.id='cdPricingStatus';status.tabIndex=-1;status.setAttribute('role','status');
    function invalidate(){draft.result=null;draft.request=null;draft.confirmed=false;if(confirm)confirm.checked=false;if(results)results.replaceChildren();}
    function field(target,label,id,value,set,options){var group=el('label',null,target);group.htmlFor=id;el('span',label,group);var n=el(options?'select':'input',null,group);n.id=id;if(options)options.forEach(function(o){var option=el('option',o[1],n);option.value=o[0];});n.value=value===null?'':value;n.addEventListener(options?'change':'input',function(){invalidate();set(n.value);});return n;}
    function nullable(v){return v.trim()===''?null:v.trim();}
    function money(v){v=nullable(v);return v!==null&&/^\d+(\.\d{1,2})?$/.test(v)?v.split('.')[0]+'.'+((v.split('.')[1]||'')+'00').slice(0,2):v;}
    function details(target,label,id){var d=el('details',null,target);d.dataset.pricingSection=id;el('summary',label,d);return d;}
    function sourceFields(target,value,id){var box=details(target,'Source And Dates',id);var options=[['owner_estimate','My Estimate']].concat(plans.sources.references.map(function(r){return[r.kind+':'+r.referenceId,r.label];}));field(box,'Source',id+'-kind',value.kind==='owner_estimate'?'owner_estimate':value.kind+':'+value.referenceId,function(v){var r=plans.sources.references.find(function(x){return x.kind+':'+x.referenceId===v;});value.kind=r?r.kind:'owner_estimate';value.referenceId=r?r.referenceId:null;value.digest=r?r.digest:null;rerender(id+'-kind');},options);field(box,'Source Note',id+'-note',value.note,function(v){value.note=v;});field(box,'Effective Date',id+'-effective',value.effectiveOn,function(v){value.effectiveOn=nullable(v);}).type='date';field(box,'Known End Date',id+'-end',value.endsOn,function(v){value.endsOn=nullable(v);}).type='date';el('p','Leave unknown dates blank. A saved reference does not verify a selling price.',box);}
    if(draft.action==='save'){
      draft.inputs.lines.forEach(function(l,i){var box=details(form,'Charge '+(i+1),l.lineId);box.open=true;var id='cdPricingLine-'+i;field(box,'Charge Name',id+'-label',l.label,function(v){l.label=v;}).required=true;
        field(box,'Pricing Model',id+'-kind',l.kind,function(v){l.kind=v;l.quantity=null;l.rate=null;l.amount=null;l.includes=[];l.unit=v==='unit'?'each':v==='retainer'?'period':null;l.period=v==='retainer'?{label:'',startsOn:'',endsOn:''}:null;rerender(id+'-kind');},[['fixed','Fixed Service Charge'],['unit','Measured Unit Charge'],['package','Package'],['retainer','Finite Retainer']]);
        if(l.kind==='fixed'||l.kind==='package')field(box,'Proposed Charge',id+'-amount',l.amount,function(v){l.amount=money(v);});else{field(box,l.kind==='retainer'?'Number Of Periods':'Quantity',id+'-quantity',l.quantity,function(v){l.quantity=nullable(v);});field(box,'Selling Rate',id+'-rate',l.rate,function(v){l.rate=nullable(v);});if(l.kind==='unit')field(box,'Unit',id+'-unit',l.unit,function(v){l.unit=v;l.quantity=null;l.rate=null;rerender(id+'-quantity');},[['each','Items'],['person_hour','Person-Hours'],['elapsed_hour','Elapsed Hours'],['ft','Feet'],['sq_ft','Square Feet'],['cu_yd','Cubic Yards'],['m','Metres'],['sq_m','Square Metres'],['cu_m','Cubic Metres'],['lb','Pounds'],['kg','Kilograms'],['US_gal','US Gallons'],['L','Litres']]);}
        field(box,'Included Scope',id+'-scope',l.scope,function(v){l.scope=v;});
        if(l.period){field(box,'Period Description',id+'-period',l.period.label,function(v){l.period.label=v;});field(box,'Start Date',id+'-start',l.period.startsOn,function(v){l.period.startsOn=v;}).type='date';field(box,'End Date',id+'-end',l.period.endsOn,function(v){l.period.endsOn=v;}).type='date';el('p','Enter the whole number of periods. Dates do not prorate or renew the charge.',box);}
        if(l.kind==='package')draft.inputs.lines.filter(function(other){return other!==l;}).forEach(function(other,j){var label=el('label',null,box);label.className='drawer-decision-confirmation';var ch=el('input',null,label);ch.type='checkbox';ch.checked=l.includes.indexOf(other.lineId)>=0;el('span','Includes '+(other.label||'Charge '+(j+1))+' — Do Not Add It Again',label);ch.onchange=function(){invalidate();l.includes=l.includes.filter(function(id){return id!==other.lineId;});if(ch.checked)l.includes.push(other.lineId);};});
        sourceFields(box,l.source,id+'-source');if(draft.inputs.lines.length>1)button('Remove Charge',function(){draft.inputs.lines.splice(i,1);draft.inputs.lines.forEach(function(x){x.includes=x.includes.filter(function(id){return id!==l.lineId;});});invalidate();rerender('cdPricingAddLine');},box);
      });
      if(draft.inputs.lines.length<12)button('Add Charge',function(){draft.inputs.lines.push(line());invalidate();rerender('cdPricingLine-'+(draft.inputs.lines.length-1)+'-label');},form,'cdPricingAddLine');
      var payments=draft.inputs.payments,paybox=details(form,'Proposed Payment Timing','payments');field(paybox,'Payment Structure','cdPricingPaymentMode',payments.mode,function(v){payments.mode=v;payments.stages=v==='none'?[]:[{stageId:crypto.randomUUID(),label:'Final Balance',kind:'balance',value:v==='share'?'100.00':'0.00'}];payments.balanceId=payments.stages.length?payments.stages[0].stageId:null;rerender('cdPricingPaymentMode');},[['none','Not Specified'],['amount','Exact Amounts'],['share','Percentages']]);
      payments.stages.forEach(function(p,i){var id='cdPricingPayment-'+i;field(paybox,'Stage Name',id+'-label',p.label,function(v){p.label=v;});if(p.kind!=='balance')field(paybox,'Stage Type',id+'-kind',p.kind,function(v){p.kind=v;},[['milestone','Milestone'],['deposit','Deposit']]);field(paybox,payments.mode==='share'?'Share (%)':'Amount',id+'-value',p.value,function(v){p.value=money(v);});if(p.kind!=='balance')button('Remove Payment Stage',function(){payments.stages.splice(i,1);invalidate();rerender();},paybox);});
      if(payments.mode!=='none'&&payments.stages.length<12)button('Add Payment Stage',function(){payments.stages.splice(payments.stages.length-1,0,{stageId:crypto.randomUUID(),label:'',kind:'milestone',value:'0.00'});invalidate();rerender('cdPricingPayment-'+(payments.stages.length-2)+'-label');},paybox);el('p','Payments divide the proposed charge. They do not add fees, create invoices or record money received.',paybox);
      var o=draft.inputs.overhead,oh=details(form,'Overhead Allocation','overhead');field(oh,'Allocation Method','cdPricingOverheadMethod',o.method,function(v){o.method=v;o.amount=null;o.percent=null;o.period=v==='period'?{startsOn:'',endsOn:'',pool:null,jobUnits:null,totalUnits:null,unit:'person_hour'}:null;rerender('cdPricingOverheadMethod');},[['unknown','Not Yet Known'],['fixed','Fixed Job Allocation'],['percent','Percentage Of Recorded Direct Costs'],['period','Share Of A Period Expense Pool']]);
      if(o.method==='fixed')field(oh,'Allocated Amount','cdPricingOverheadAmount',o.amount,function(v){o.amount=money(v);});if(o.method==='percent')field(oh,'Allocation (%)','cdPricingOverheadPercent',o.percent,function(v){o.percent=nullable(v);});if(o.period){field(oh,'Start Date','cdPricingOverheadStart',o.period.startsOn,function(v){o.period.startsOn=v;}).type='date';field(oh,'End Date','cdPricingOverheadEnd',o.period.endsOn,function(v){o.period.endsOn=v;}).type='date';field(oh,'Period Expense Pool','cdPricingOverheadPool',o.period.pool,function(v){o.period.pool=money(v);});field(oh,'Allocation Unit','cdPricingOverheadUnit',o.period.unit,function(v){o.period.unit=v;o.period.jobUnits=null;o.period.totalUnits=null;rerender('cdPricingOverheadJob');},[['person_hour','Person-Hours'],['job','Jobs']]);field(oh,'This Job’s Units','cdPricingOverheadJob',o.period.jobUnits,function(v){o.period.jobUnits=nullable(v);});field(oh,'Total Period Units','cdPricingOverheadTotal',o.period.totalUnits,function(v){o.period.totalUnits=nullable(v);});}sourceFields(oh,o.source,'cdPricingOverheadSource');
      field(oh,'Included-Cost Review','cdPricingCoverage',o.coverage.status,function(v){o.coverage.status=v;o.coverage.included=[];rerender('cdPricingCoverage');},[['unknown','Not Yet Resolved'],['disjoint','This Allocation Is Separate From Recorded Costs'],['allocated','Part Is Already Included In Recorded Costs']]);field(oh,'Allocation Explanation','cdPricingCoverageNote',o.coverage.explanation,function(v){o.coverage.explanation=v;});
      if(o.coverage.status==='allocated'){var refs=plans.sources.basis.overheadIncluded||[];if(!refs.length)el('p','No supported recorded amount is available for this allocation. Keep the overlap unresolved or review a separate expense pool.',oh);refs.forEach(function(r,i){var found=o.coverage.included.find(function(x){return x.referenceId===r.referenceId;});field(oh,'Included Share — '+r.label+' (Maximum '+decisionMoney(r.amount,review.currency)+')','cdPricingIncluded-'+i,found?found.amount:null,function(v){o.coverage.included=o.coverage.included.filter(function(x){return x.referenceId!==r.referenceId;});if(nullable(v)!==null)o.coverage.included.push({referenceId:r.referenceId,amount:money(v)});});});el('p','Any overhead share is your declared allocation. A task total does not verify which expenses it contains.',oh);}
    }
    field(form,'Reason For This Change','cdPricingReason',draft.reason,function(v){draft.reason=v;}).required=true;
    var results=el('div',null,form);if(draft.result){resultView(draft.result,results);pricingCautions(draft.assessment,results,draft.inputs);}
    var label=el('label',null,form);label.className='drawer-decision-confirmation';var confirm=el('input',null,label);confirm.type='checkbox';confirm.id='cdPricingConfirm';confirm.checked=draft.confirmed;el('span',draft.action==='withdraw'?'I reviewed withdrawing this pricing proposal. Saved history and the separate approved price remain unchanged.':'I reviewed the proposed charge, payment timing, overhead allocation and source limitations. This does not approve or send a customer price.',label);confirm.onchange=function(){draft.confirmed=confirm.checked;};
    var actions=el('div',null,form);actions.className='drawer-review-actions';if(draft.action==='save')button('Calculate Pricing',function(){send(true);},actions,'cdPricingCalculate');var save=el('button',draft.action==='withdraw'?'Confirm Withdrawal':'Save Pricing Proposal',actions);save.type='submit';save.className='btn btn-primary';save.id='cdPricingSave';actions.id='cdPricingActions';bindReviewActions(root,actions);button('Cancel',function(){_pricingPlanDraft=null;rerender('cdPricingStart');},actions,'cdPricingCancel');
    form.onsubmit=function(e){e.preventDefault();if(!draft.confirmed||draft.action==='save'&&!draft.result){status.textContent=draft.action==='withdraw'?'Review and confirm the withdrawal before saving.':'Calculate pricing, then review and confirm the proposal.';status.focus();return;}send(false);};
    function send(preview){if(!form.reportValidity())return;var attempt=!preview&&draft.request;if(!attempt){attempt={key:crypto.randomUUID(),workspaceRevision:review.demoWorkspaceRevision,body:{action:draft.action,expectedRevision:plans.current?plans.current.revision:0,expectedDigest:plans.current?plans.current.digest:'none',sourcePins:review.pins,expectedDecisionRevision:plans.decisionBasis.revision,expectedDecisionDigest:plans.decisionBasis.digest,inputs:draft.action==='withdraw'?null:JSON.parse(JSON.stringify(draft.inputs)),currency:review.currency,reason:draft.reason,confirmed:true,confirmationVersion:plans.contract,evidenceDigest:draft.evidenceDigest||plans.sources.digest}};if(!preview)draft.request=attempt;}
      var headers={'Content-Type':'application/json','Idempotency-Key':attempt.key};if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(attempt.workspaceRevision);var disabled=Array.prototype.map.call(form.elements,function(x){var d=x.disabled;x.disabled=true;return d;});status.textContent=preview?'Calculating Pricing…':'Saving Pricing Proposal…';
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/pricing-plan-preview':'/pricing-plans'),{method:'POST',headers:headers,body:JSON.stringify(attempt.body)}).then(function(response){return response.json().catch(function(){return{};}).then(function(b){if(!response.ok)throw{status:response.status,category:b.error&&b.error.category};return b;});}).then(function(b){if(generation!==_openSequence||draft!==_pricingPlanDraft||review!==_estimateReview)return;if(preview){if(!b.success||JSON.stringify(b.data.sourcePins)!==JSON.stringify(review.pins)||!b.data.decisionBasis||b.data.decisionBasis.revision!==plans.decisionBasis.revision||b.data.decisionBasis.digest!==plans.decisionBasis.digest)throw{status:409};draft.result=b.data.result;draft.assessment=b.data.assessment;draft.evidenceDigest=b.data.evidenceDigest;draft.request=null;draft.confirmed=false;confirm.checked=false;results.replaceChildren();resultView(draft.result,results);pricingCautions(draft.assessment,results,draft.inputs);status.textContent='Review the proposed amounts and source dates, including any unknowns, then confirm to save.';}else{_pricingPlanDraft=null;refreshEstimateReview('pricing-saved');}}).catch(function(e){if(generation!==_openSequence||draft!==_pricingPlanDraft||review!==_estimateReview)return;var paused=e.status===503&&e.category==='pricing_paused',known=[400,401,403,404,409,410,413,429].indexOf(e.status)>=0||paused;status.textContent=e.status===400?'Check the pricing quantities, payment totals and overhead allocation. Calculate again.':e.status===401?'Sign in again before saving.':e.status===403?'Your current account cannot save pricing plans.':e.status===404?'This estimate is unavailable. Choose a current estimate.':e.status===409?'The estimate, proposal or sources changed. Refresh, calculate again and confirm.':e.status===410?'This demo session expired. Refresh to start again.':e.status===413?'Shorten the pricing entries and source notes before trying again.':e.status===429?(e.category==='pricing_history_limit'?'This demo has reached its pricing history limit. Saved history remains available. Deliberately resetting removes its saved practice work.':'Saving is currently limited. Check saved history and try later.'):paused?'New pricing plans are paused. Refresh to check saved history.':preview?'Pricing could not be calculated. Try calculating again.':'The save result is unconfirmed. Retry this same attempt without changing entries, or refresh to check saved history.';if(known||preview)invalidate();}).finally(function(){if(generation===_openSequence&&draft===_pricingPlanDraft&&review===_estimateReview){Array.prototype.forEach.call(form.elements,function(x,i){x.disabled=disabled[i];});status.focus();}});
    }
  }
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
    select.onchange=function(){_selectedEstimateRevision=Number(select.value);_laborPlanDraft=null;_travelPlanDraft=null;_equipmentPlanDraft=null;_equipmentCostDraft=null;_equipmentReadinessDraft=null;_decisionDraft=null;_materialPlanDraft=null;_adoptionDraft=null;refreshEstimateReview('revision-selected');};label.appendChild(select);parent.appendChild(label);
    if(!review.isCurrent){var note=document.createElement('p');note.textContent='Viewing an earlier estimate. Select the current estimate to make changes.';parent.appendChild(note);}
  }
  function renderMaterialAdoption(review,parent) {
    var root=document.createElement('section');root.id='cdMaterialAdoption';parent.appendChild(root);
    function para(value){var p=document.createElement('p');p.textContent=value;p.style.overflowWrap='anywhere';root.appendChild(p);return p;}
    function button(label,fn,id){var b=document.createElement('button');b.type='button';b.className='btn btn-secondary btn-sm';b.textContent=label;b.id=id||'';b.style.margin='0.5rem 0.5rem 0 0';b.onclick=fn;root.appendChild(b);return b;}
    var available={material:review.materialPlans&&review.materialPlans.current,labor:review.laborPlans&&review.laborPlans.current,equipment:review.equipmentCostPlans&&review.equipmentCostPlans.current,travel:review.travelPlans&&review.travelPlans.current};
    var component=_adoptionDraft?_adoptionDraft.component:'material',plan=available[component];
    if(review.adoptionPaused){para('New estimate changes are paused. Saved estimates remain available.');return;}
    if(!review.canAdopt)return;
    var basis=JSON.stringify([review.pins,review.travelCostComponents,review.travelCoverageChoices,review.decisions.writeBasis,available.material&&available.material.digest,available.labor&&available.labor.digest,available.equipment&&available.equipment.digest,available.travel&&available.travel.digest]);
    if(_adoptionDraft&&_adoptionDraft.basis!==basis){_adoptionDraft.result=null;_adoptionDraft.confirmed=false;_adoptionDraft.request=null;_adoptionDraft.basis=basis;_adoptionDraft.changed=true;}
    function redraw(){var focusId=document.activeElement&&document.activeElement.id;root.remove();renderMaterialAdoption(review,parent);if(focusId&&$(focusId))$(focusId).focus();}
    if(!_adoptionDraft){['material','labor','equipment','travel'].forEach(function(kind){var saved=available[kind],title={material:'Material',labor:'Labor',equipment:'Equipment Cost',travel:'Travel'}[kind];if(!saved||saved.action!=='save')return;if(review.costComponents&&review.costComponents[kind]&&review.costComponents[kind].id===saved.id)return;if(JSON.stringify(saved.sourcePins)!==JSON.stringify(review.pins)){para('Review and save the '+kind+' plan for this current estimate before applying it.');return;}if(kind==='equipment'&&!saved.result.complete&&!(review.pins.revision&&review.pins.revision.calculationVersion==='estimate-cost-adoption-v3')){para('Resolve the missing equipment costs and outside-cost coverage before applying this plan.');return;}button('Use '+title+' Plan In Estimate',function(){_adoptionDraft={component:kind,basis:basis,reason:'',confirmed:false,result:null,request:null};redraw();$('cdAdoptionReason').focus();},{material:'cdAdoptionStart',labor:'cdLaborAdoptionStart',equipment:'cdEquipmentCostAdoptionStart',travel:'cdTravelAdoptionStart'}[kind]);});return;}
    if(!plan||plan.action!=='save'){_adoptionDraft=null;redraw();return;}
    var useTravel=component==='travel'||review.pins.revision&&review.pins.revision.calculationVersion==='estimate-cost-adoption-v3',coverageChoice=useTravel&&review.travelCoverageChoices&&review.travelCoverageChoices[component];
    var draft=_adoptionDraft,form=document.createElement('form');form.id='cdAdoptionForm';root.appendChild(form);
    var intro=document.createElement('p');intro.textContent='Replace the selected cost with this saved plan. Keep the other included costs and all earlier estimates. Review the job and price again afterward.';form.appendChild(intro);
    var label=document.createElement('label');label.textContent='Reason For Using This '+({material:'Material',labor:'Labor',equipment:'Equipment Cost',travel:'Travel'}[component])+' Plan';label.style.display='block';
    var reason=document.createElement('textarea');reason.id='cdAdoptionReason';reason.required=true;reason.maxLength=2000;reason.value=draft.reason;reason.style.cssText='display:block;width:100%;box-sizing:border-box;padding:0.65rem;color:#172033;background:white;';label.appendChild(reason);form.appendChild(label);
    if(useTravel){
      if(!coverageChoice||coverageChoice.unavailable){para('Complete the saved equipment bundle amounts before reviewing these combined costs.');return;}
      if(!draft.coverage||JSON.stringify(draft.coverage.componentManifest)!==JSON.stringify(coverageChoice.componentManifest)){draft.coverage={componentManifest:coverageChoice.componentManifest,overlaps:[],travelOutside:(coverageChoice.travelOutside||[]).map(function(x){return{travelLineId:x.travelLineId,component:'equipment',sourceLineId:'',amount:'',reason:''};}),equipmentOutside:coverageChoice.equipmentOutside.map(function(x){return {equipmentLineId:x.equipmentLineId,kind:x.kind,component:x.kind==='operator'?'labor':'travel',targetLineId:'',targetCategory:x.kind==='operator'?'travel_labor':'',amount:x.amount,reason:''};}),confirmed:false,reason:''};draft.result=null;draft.confirmed=false;draft.request=null;}
      var coverage=document.createElement('details');coverage.open=true;var title=document.createElement('summary');title.textContent='Where These Costs Are Included';coverage.appendChild(title);form.appendChild(coverage);
      function coverageChanged(){draft.coverage.confirmed=false;draft.result=null;draft.confirmed=false;draft.request=null;if(coverageConfirm)coverageConfirm.checked=false;if(confirm)confirm.checked=false;if(result)showResult();}
      var coverageFieldSequence=0;
      function coverageField(target,label,value,change,options){var wrapper=document.createElement('label');wrapper.textContent=label;wrapper.style.cssText='display:flex;flex-direction:column;gap:0.35rem;margin:0.65rem 0;';var input=document.createElement(options?'select':'input');input.id='cdCoverageField-'+(coverageFieldSequence++);input.style.cssText='width:100%;box-sizing:border-box;padding:0.65rem;font:inherit;background:white;color:#172033;';if(options)options.forEach(function(o){var e=document.createElement('option');e.value=o[0];e.textContent=o[1];input.appendChild(e);});input.value=value||'';input.onchange=function(){change(input.value);coverageChanged();};if(!options)input.oninput=input.onchange;wrapper.appendChild(input);target.appendChild(wrapper);return input;}
      var categoryNames={vehicle:'Vehicle Cost',fuel_energy:'Fuel And Energy',maintenance:'Maintenance',ownership_insurance:'Ownership And Insurance',travel_labor:'Travel Labor',mobilization:'Mobilization',loading:'Loading Or Unloading',waiting:'Waiting',delivery:'Delivery',tolls:'Tolls',parking:'Parking',permit:'Permit',accommodation:'Accommodation',access:'Access'};
      var explanation=document.createElement('p');explanation.textContent='Identify any travel cost already included in labor or equipment. Only the reviewed amount is deducted from travel; the covering cost stays once. Similar task names do not prove the same expense.';coverage.appendChild(explanation);
      draft.coverage.overlaps.forEach(function(row,index){var box=document.createElement('fieldset');box.style.cssText='min-width:0;margin:0.75rem 0;padding:0.75rem;';var legend=document.createElement('legend');legend.textContent='Already Included Cost '+(index+1);box.appendChild(legend);coverage.appendChild(box);coverageField(box,'Travel Cost',row.travelLineId,function(v){row.travelLineId=v;row.category='';row.amount='';coverageChanged();redraw();},[['','Choose A Travel Cost']].concat(coverageChoice.travelLines.map(function(l){return[l.id,l.label];})));var line=coverageChoice.travelLines.find(function(l){return l.id===row.travelLineId;});coverageField(box,'Cost Category',row.category,function(v){row.category=v;row.amount='';},[['','Choose A Category']].concat((line&&line.categories||[]).map(function(c){return[c.category,(categoryNames[c.category]||'Travel Cost')+' — Up To '+decisionMoney(c.amount,review.currency)];})));coverageField(box,'Already Included In',row.component,function(v){row.component=v;row.sourceLineId='';coverageChanged();redraw();},[['labor','Labor'],['equipment','Equipment']]);coverageField(box,'Covering Cost',row.sourceLineId,function(v){row.sourceLineId=v;},[['','Choose The Covering Cost']].concat(coverageChoice.costLines[row.component].map(function(l){return[l.id,l.label];})));coverageField(box,'Amount Already Included ('+review.currency+')',row.amount,function(v){row.amount=v;}).required=true;coverageField(box,'Why This Is The Same Expense',row.reason,function(v){row.reason=v;}).required=true;var remove=document.createElement('button');remove.type='button';remove.className='btn btn-secondary';remove.textContent='Remove Included Cost';remove.onclick=function(){draft.coverage.overlaps.splice(index,1);coverageChanged();redraw();};box.appendChild(remove);});
      if(draft.coverage.overlaps.length<24&&coverageChoice.travelLines.length){var add=document.createElement('button');add.type='button';add.className='btn btn-secondary';add.textContent='Record An Already Included Travel Cost';add.id='cdCoverageAddOverlap';add.onclick=function(){draft.coverage.overlaps.push({travelLineId:'',category:'',component:'labor',sourceLineId:'',amount:'',reason:''});coverageChanged();redraw();};coverage.appendChild(add);}
      (draft.coverage.travelOutside||[]).forEach(function(row,index){var fact=coverageChoice.travelOutside[index],box=document.createElement('fieldset');box.style.cssText='min-width:0;margin:0.75rem 0;padding:0.75rem;';var legend=document.createElement('legend');legend.textContent=fact.label+' — Other Vehicle Costs';box.appendChild(legend);coverage.appendChild(box);var note=document.createElement('p');note.textContent='Fuel or energy was calculated separately. Identify the retained equipment amount covering the other vehicle costs. This allocation is not added or deducted again.';box.appendChild(note);coverageField(box,'Covering Equipment Cost',row.sourceLineId,function(v){row.sourceLineId=v;},[['','Choose The Covering Cost']].concat(coverageChoice.costLines.equipment.map(function(l){return[l.id,l.label];})));coverageField(box,'Other Vehicle Amount Already Included ('+review.currency+')',row.amount,function(v){row.amount=v;}).required=true;coverageField(box,'Which Other Vehicle Costs This Covers',row.reason,function(v){row.reason=v;}).required=true;});
      draft.coverage.equipmentOutside.forEach(function(row,index){var fact=coverageChoice.equipmentOutside[index],box=document.createElement('fieldset');box.style.cssText='min-width:0;margin:0.75rem 0;padding:0.75rem;';var legend=document.createElement('legend');legend.textContent=fact.label+' — '+(row.kind==='operator'?'Operator Labor':'Travel')+' Allocation';box.appendChild(legend);coverage.appendChild(box);var note=document.createElement('p');note.textContent=decisionMoney(row.amount,review.currency)+' was excluded from equipment cost and must be accounted for in the retained '+(row.component==='labor'?'labor':'travel')+' cost.';box.appendChild(note);var lines=row.component==='labor'?coverageChoice.costLines.labor:coverageChoice.travelLines;coverageField(box,'Covering Cost',row.targetLineId,function(v){row.targetLineId=v;if(row.component==='travel'){row.targetCategory='';coverageChanged();redraw();}},[['','Choose The Covering Cost']].concat(lines.map(function(l){return[l.id,l.label];})));if(row.component==='travel'){var line=coverageChoice.travelLines.find(function(l){return l.id===row.targetLineId;});coverageField(box,'Covered Travel Category',row.targetCategory,function(v){row.targetCategory=v;},[['','Choose A Category']].concat((line&&line.categories||[]).map(function(c){return[c.category,categoryNames[c.category]||'Travel Cost'];})));}coverageField(box,'Allocation Explanation',row.reason,function(v){row.reason=v;}).required=true;});
      coverageField(coverage,'Cost Ownership Explanation',draft.coverage.reason,function(v){draft.coverage.reason=v;}).required=true;
      var coverageLabel=document.createElement('label');coverageLabel.className='drawer-decision-confirmation';var coverageConfirm=document.createElement('input');coverageConfirm.type='checkbox';coverageConfirm.id='cdCoverageConfirm';coverageConfirm.checked=draft.coverage.confirmed;coverageConfirm.style.cssText='width:20px;height:20px;min-height:0;padding:0;';var coverageText=document.createElement('span');coverageText.textContent='I reviewed which costs are separate and which amounts are already included. No expense is counted twice.';coverageLabel.append(coverageConfirm,coverageText);coverage.appendChild(coverageLabel);coverageConfirm.onchange=function(){draft.coverage.confirmed=coverageConfirm.checked;draft.result=null;draft.confirmed=false;draft.request=null;if(confirm)confirm.checked=false;if(result)showResult();};
    }
    var result=document.createElement('div');result.id='cdAdoptionResult';form.appendChild(result);
    function showResult(){result.replaceChildren();if(!draft.result)return;var dl=document.createElement('dl');[['Material','knownDirectMaterialCost'],['Labor','knownInternalLaborCost'],['Equipment','knownEquipmentCost'],['Travel','knownTravelInternalCost'],['Recorded Direct Costs','knownDirectCosts']].forEach(function(row){var term=document.createElement('dt'),value=document.createElement('dd');term.textContent=row[0]+(row[0].toLowerCase()===component?' — Replaced':' — Retained');if(row[0]==='Recorded Direct Costs')term.textContent=row[0];var label='Recorded '+row[0].toLowerCase()+' cost',prior=(review.rows||[]).find(function(r){return r.label===label;});var old=review.financialCosts?review.financialCosts[row[1]]:prior&&prior.amount;if(typeof old==='number'&&Number.isFinite(old)&&old>=0&&/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(String(old))){var oldParts=String(old).split('.');old=oldParts[0]+'.'+(oldParts[1]||'').padEnd(2,'0');}var inactive=draft.result.applicability&&draft.result.applicability[row[0].toLowerCase()]===false;var after=inactive?'Not Applicable':decisionMoney(draft.result[row[1]],review.currency);value.textContent=row[0].toLowerCase()===component?'Before: '+decisionMoney(old,review.currency)+' → After: '+after:after;dl.append(term,value);});result.append(dl);var note=document.createElement('p');note.textContent='Original price and tax stay unchanged. Missing applicable costs keep the total unavailable.';result.append(note);var cautions=document.createElement('p'),a=draft.assessment||{},names={date_unknown:'Date Not Recorded',freshness_unknown:'Freshness Unknown',not_yet_effective:'Future Source Date',expired:'Expired Source',applicability_unknown:'Applicability Not Recorded',availability_unknown:'Availability Unknown',rental_minimum_unknown:'Rental Minimum Not Recorded'};var words=[];function add(code){var word=names[code]||'Source Needs Review';if(words.indexOf(word)<0)words.push(word);}(a.equipmentSource&&a.equipmentSource.cautions||[]).forEach(function(c){c.codes.forEach(add);});(a.laborSource&&a.laborSource.cautions||[]).forEach(function(c){c.codes.forEach(add);});(a.travelSource&&a.travelSource.cautions||[]).forEach(function(c){c.codes.forEach(add);});[a.materialSource,a.materialAvailability].forEach(function(x){(x&&x.lines||[]).forEach(function(l){l.flags.forEach(add);});});cautions.textContent=words.length?'Recorded Source Cautions: '+words.join(' · ')+'. Open the included plans for the supporting details.':'Source information remains human-recorded; it has not been independently verified.';result.append(cautions);}showResult();
    var confirmLabel=document.createElement('label'),confirm=document.createElement('input');confirm.id='cdAdoptionConfirm';confirm.type='checkbox';confirm.style.cssText='width:20px;height:20px;min-height:0;padding:0;';confirm.checked=draft.confirmed;confirmLabel.className='drawer-decision-confirmation';confirmLabel.appendChild(confirm);var consentText=document.createElement('span');consentText.textContent='I reviewed the replacement, retained costs and source cautions. Use this plan in a new estimate; my earlier price review does not carry forward.';confirmLabel.appendChild(consentText);form.appendChild(confirmLabel);
    var status=document.createElement('p');status.id='cdAdoptionStatus';status.setAttribute('role','status');status.tabIndex=-1;status.textContent=draft.changed?'The saved information changed. Preview and confirm again.':'';form.appendChild(status);
    reason.oninput=function(){draft.reason=reason.value;draft.confirmed=false;confirm.checked=false;draft.result=null;draft.request=null;showResult();};confirm.onchange=function(){draft.confirmed=confirm.checked;draft.request=null;};
    function formButton(text,fn){var b=document.createElement('button');b.type='button';b.className='btn btn-secondary btn-sm';b.textContent=text;b.style.margin='0.5rem 0.5rem 0 0';b.onclick=fn;form.appendChild(b);}
    function send(preview){
      if(!form.reportValidity())return;if(useTravel&&!draft.coverage.confirmed){status.textContent='Review and confirm where the costs are included before previewing.';status.focus();return;}if(!preview&&(!draft.result||!draft.confirmed)){status.textContent='Preview the costs, then confirm before saving.';status.focus();return;}
      var v2=component==='equipment'||review.pins.revision&&review.pins.revision.calculationVersion==='estimate-cost-adoption-v2';var body={sourcePins:review.pins,expectedPlanId:plan.id,expectedPlanRevision:plan.revision,expectedPlanDigest:plan.digest,expectedDecisionRevision:review.decisions.writeBasis.revision,expectedDecisionDigest:review.decisions.writeBasis.digest,reason:draft.reason.trim(),confirmed:preview?false:draft.confirmed,confirmationVersion:useTravel?'estimate-cost-adoption-v3':v2?'estimate-cost-adoption-v2':'estimate-cost-adoption-v1',changedComponent:component,expectedComponents:useTravel?review.travelCostComponents:v2?review.equipmentCostComponents:review.costComponents,assessment:draft.assessment||{}};if(useTravel)body.coverage=draft.coverage;
      if(!preview&&!draft.request)draft.request={key:crypto.randomUUID(),body:body,demoRevision:review.demoWorkspaceRevision};
      var attempt=preview?{key:crypto.randomUUID(),body:body,demoRevision:review.demoWorkspaceRevision}:draft.request;
      var headers={'Content-Type':'application/json','Idempotency-Key':attempt.key};if(review.simulated)headers['X-NorthStar-Demo-Revision']=String(attempt.demoRevision);
      var generation=_openSequence;Array.prototype.forEach.call(form.elements,function(c){c.disabled=true;});status.textContent=preview?'Preparing cost review.':'Saving estimate.';
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+(preview?'/cost-adoption-preview':'/cost-adoptions'),{method:'POST',headers:headers,body:JSON.stringify(attempt.body)}).then(function(response){return response.json().catch(function(){return {};}).then(function(data){if(!response.ok)throw {status:response.status,category:data.error&&data.error.category};return data;});}).then(function(data){
        if(generation!==_openSequence||_adoptionDraft!==draft||_estimateReview!==review)return;
        if(preview){if(!data.success||JSON.stringify(data.data.sourcePins)!==JSON.stringify(review.pins)||data.data.planId!==plan.id||data.data.planDigest!==plan.digest||!data.data.decisionBasis||data.data.decisionBasis.revision!==review.decisions.writeBasis.revision||data.data.decisionBasis.digest!==review.decisions.writeBasis.digest)throw {status:409};draft.result=data.data.result;draft.assessment=data.data.assessment;draft.confirmed=false;confirm.checked=false;showResult();status.textContent='Review these costs, then confirm to save.';}
        else{_adoptionDraft=null;_decisionDraft=null;_materialPlanDraft=null;_laborPlanDraft=null;_travelPlanDraft=null;_equipmentPlanDraft=null;_equipmentCostDraft=null;_equipmentReadinessDraft=null;_selectedEstimateRevision=null;refreshEstimateReview('adoption-saved');}
      }).catch(function(error){if(generation!==_openSequence||_adoptionDraft!==draft||_estimateReview!==review)return;
        status.textContent=error.status===401?'Sign in again, then reopen this estimate.':error.status===403?'Your current account cannot change this estimate.':error.status===404?'This estimate is unavailable. Refresh or reopen the customer to choose an available estimate.':error.status===413?'This estimate change has too much text. Shorten your reason, then preview and confirm again.':error.status===410?'This demo session expired. Reopen the demo to continue.':error.status===409?'The estimate, plan or price review changed. Refresh and review again.':error.status===400?'Check the plan’s costs, sources and reason before continuing.':error.status===429?'Estimate changes are temporarily or permanently limited. Refresh to check saved history before continuing.':error.status===503&&error.category==='adoption_paused'?'New estimate changes are paused. Refresh to check saved history.':'The save could not be confirmed. Retry this same attempt before changing your entries.';
        if([400,401,403,404,409,410,413,429].indexOf(error.status)>=0||error.category==='adoption_paused'){draft.confirmed=false;confirm.checked=false;draft.result=null;draft.request=null;showResult();}
      }).finally(function(){if(generation===_openSequence&&_adoptionDraft===draft&&_estimateReview===review){Array.prototype.forEach.call(form.elements,function(c){c.disabled=false;});status.focus();}});
    }
    formButton('Preview Estimate Costs',function(){send(true);});formButton('Save New Estimate',function(){send(false);});formButton('Cancel Estimate Change',function(){_adoptionDraft=null;redraw();var start=$({material:'cdAdoptionStart',labor:'cdLaborAdoptionStart',equipment:'cdEquipmentCostAdoptionStart',travel:'cdTravelAdoptionStart'}[component]);if(start)start.focus();});form.onsubmit=function(e){e.preventDefault();};
  }

  function renderGroundedRecommendations(review, parent) {
    var data=review.groundedRecommendations;if(!data)return;
    var root=document.createElement('details');root.id='cdGroundedRecommendations';root.className='drawer-labor-plan';parent.appendChild(root);
    function node(tag,text,target){var n=document.createElement(tag);if(text!==null)n.textContent=text;(target||root).appendChild(n);return n;}
    node('summary','Review Suggestions');node('p',data.message);
    if(data.state!=='ready')return;
    if(data.historical)node('p','Earlier Estimate — Actions Are Read-Only. Current source cautions are shown separately from saved history.');
    if(data.simulated)node('p','Simulated company and job facts.');
    var targets={costs:'cdEstimateCostRows',materials:'cdMaterialReview',labor:'cdLaborPlan',equipment:'cdEquipmentPlan',equipment_cost:'cdEquipmentCosts',readiness:'cdEquipmentReadiness',travel:'cdTravelPlan',pricing:'cdPricingPlan',policy:'cdPolicyPlan',commercial:'cdCommercialTerms'};
    (data.items||[]).forEach(function(item){var box=node('details',null);node('summary',item.title,box);node('p',item.reason,box);
      if(item.action&&targets[item.action]){var actionLabels={costs:'Review Cost Details',materials:'Review Materials',labor:'Review Labor',equipment:'Review Equipment',equipment_cost:'Review Equipment Costs',readiness:'Review Readiness',travel:'Review Travel',pricing:'Review Pricing',policy:'Review Pricing Policy',commercial:'Review Price And Terms'};var b=node('button',actionLabels[item.action],box);b.type='button';b.className='btn btn-secondary';b.addEventListener('click',function(){if(_estimateReview!==review)return;var destination=document.getElementById(targets[item.action]);if(!destination)return;for(var p=destination;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;var focus=destination.matches('select,input,button,[tabindex]')?destination:destination.querySelector('summary,button,input,select');if(focus){focus.focus();focus.scrollIntoView({block:'nearest'});}});}
      var labels=(item.sourceIds||[]).map(function(id){return(data.sources||[]).find(function(x){return x.id===id;});}).filter(Boolean).map(function(x){return x.label;});if(labels.length)node('p','Basis: '+labels.join(' · '),box);
    });
    if(!(data.items||[]).length)node('p','No additional suggestion was identified from the available saved facts. This does not establish safety, availability or price accuracy.');
    if(data.omitted)node('p','Showing the highest-priority suggestions. Review the remaining details in the sections below.');
    var sources=node('details',null);node('summary','Sources And Assumptions',sources);
    node('p','Recorded facts, owner declarations and calculations have different limits. A published reference may help explain the job, but does not establish safe use or job suitability.',sources);
    (data.sources||[]).forEach(function(source){var entry=node('div',null,sources);node('strong',source.label,entry);var kind={calculated_result:'Calculated From Saved Facts',owner_declaration:'Owner-Recorded Information',reviewed_source:'Reviewed Source'}[source.kind]||'Recorded Information';node('p',kind,entry);
      if(source.recordedAt){var d=new Date(source.recordedAt);if(Number.isFinite(d.getTime()))node('p','Recorded '+d.toLocaleDateString(),entry);}
      if(source.freshness)node('p',source.freshness==='unknown'?'Check whether this source is still current.':source.freshness==='expired'?'The recorded source end date has passed.':'A source end date is recorded; this is not independent verification.',entry);
      if(source.limitations)node('p',source.limitations,entry);
      // Only text values, never raw object keys, HTML, URLs or executable source instructions.
      if(source.content){var excerpts=[];function collect(v,depth){if(depth>3||excerpts.length>=6)return;if(typeof v==='string'&&v.trim())excerpts.push(v.slice(0,1200));else if(Array.isArray(v))v.forEach(function(x){collect(x,depth+1);});else if(v&&typeof v==='object')Object.keys(v).forEach(function(k){collect(v[k],depth+1);});}collect(source.content,0);excerpts.forEach(function(text){node('blockquote',text,entry);});}
    });
    var comparison=node('details',null);node('summary','Earlier Recorded Estimates',comparison);var c=data.comparisons||{};
    node('p','Original recorded estimates only — not completed-job costs, current revisions or verified market prices.',comparison);
    if(!(c.examples||[]).length)node('p',c.state==='scope_unavailable'?'The measurements and units needed for a comparison are not fully recorded.':'No matching earlier estimate was found among the records checked.',comparison);
    (c.examples||[]).forEach(function(example){node('p',new Date(example.recordedAt).toLocaleDateString()+' · '+(example.amount===null?'Original Price Unavailable':decisionMoney(example.amount,example.currency)),comparison);});
    if(c.truncated)node('p','Only the most recent 50 records were examined. Additional records were not compared.',comparison);
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

  var _capellaScenarioDraft=null;
  function renderCapellaScenarios(review,host){
    var basis=review.capellaScenarios;if(!basis||basis.contract!=='NorthStarCapellaScenarios/v1')return;
    function el(tag,text,parent){var n=document.createElement(tag);if(text!==null)n.textContent=text;if(parent)parent.appendChild(n);return n;}
    var key=review.pins.estimateId+':'+review.selectedRevision;
    if(!_capellaScenarioDraft||_capellaScenarioDraft.key!==key)_capellaScenarioDraft={key:key,digest:basis.digest,price:basis.prices[0]?basis.prices[0].id:'',open:false,scenarios:{},result:null};
    var draft=_capellaScenarioDraft,changed=draft.digest!==basis.digest;draft.digest=basis.digest;if(changed){draft.stale=false;draft.result=null;Object.keys(draft.scenarios).forEach(function(k){draft.scenarios[k].overheadSeparate=false;});}
    var details=el('details',null,host);details.id='cdCapellaScenarios';details.open=draft.open;details.ontoggle=function(){draft.open=details.open;};el('summary','Scenario Analysis',details);
    el('p',basis.historical?'Analysis Of An Earlier Estimate — Unsaved Assumptions':'Unsaved Assumptions — Changes Here Do Not Change The Estimate',details);
    el('p','Compare explicit changes in costs and net price. Missing figures stay unknown. Reloading clears this analysis.',details);
    if(basis.simulated)el('p','Simulated Company And Job Facts',details);(basis.readiness&&basis.readiness.notices||[]).forEach(function(n){el('p',n.reason,details);});
    if(basis.sourceCautions&&((basis.sourceCautions.pricing&&basis.sourceCautions.pricing.cautions||[]).length||(basis.sourceCautions.policy&&basis.sourceCautions.policy.cautions||[]).length))el('p','Saved pricing or policy source dates need review. These amounts are declared inputs, not verified market prices.',details);
    var form=el('form',null,details);form.className='capella-scenario-form';
    var label=el('label','Saved Price Basis',form),price=el('select',null,label);price.id='cdScenarioPrice';el('option','Select An Available Price',price).value='';basis.prices.forEach(function(p){el('option',p.label+' — '+decisionMoney(p.amount,basis.currency),price).value=p.id;});price.value=draft.price;price.onchange=function(){draft.price=price.value;invalidate();};
    var baseline=el('dl',null,form);[['Selected Direct Costs',basis.directCosts],['Gross Overhead',basis.overhead&&basis.overhead.gross],['Already Included In Direct Costs',basis.overhead&&basis.overhead.alreadyIncluded],['Additional Overhead',basis.overhead&&basis.overhead.incremental]].forEach(function(row){el('dt',row[0],baseline);el('dd',decisionMoney(row[1],basis.currency),baseline);});
    el('p','Additional overhead changes are fixed allocation assumptions, even if the saved allocation uses a percentage or period. Do not add expenses already included in direct costs.',form);
    var grid=el('div',null,form);grid.className='capella-scenario-grid';
    ['favorable','adverse'].forEach(function(kind){var v=draft.scenarios[kind]||(draft.scenarios[kind]={kind:kind,active:false,directChange:null,overheadChange:null,priceChange:null,overheadSeparate:false,source:{kind:'owner_estimate',referenceId:null,digest:null,note:'',effectiveOn:null,endsOn:null}});
      var box=el('fieldset',null,grid);el('legend',kind==='favorable'?'Favorable':'Adverse',box);var enabledLabel=el('label',null,box);enabledLabel.className='capella-scenario-check';var active=el('input',null,enabledLabel);active.type='checkbox';active.id='cdScenario-'+kind+'-active';active.checked=v.active;el('span','Include This Scenario',enabledLabel);var fields=el('div',null,box);fields.hidden=!v.active;active.onchange=function(){v.active=active.checked;fields.hidden=!v.active;invalidate();};
      [['directChange','Direct Cost Change'],['overheadChange','Additional Overhead Change'],['priceChange','Net Price Change Before Tax']].forEach(function(row){var l=el('label',row[1]+' ('+basis.currency+')',fields),input=el('input',null,l);input.type='text';input.inputMode='decimal';input.id='cdScenario-'+kind+'-'+row[0];input.placeholder='Unknown; enter 0.00 for unchanged';input.value=v[row[0]]===null?'':v[row[0]];input.oninput=function(){v[row[0]]=input.value===''?null:input.value;invalidate();};});
      var srcLabel=el('label','Assumption Source',fields),src=el('select',null,srcLabel);src.id='cdScenario-'+kind+'-source';el('option','Owner Or Estimator Assumption',src).value='owner';basis.references.forEach(function(r,index){el('option',r.label,src).value=String(index);});var sourceIndex=basis.references.findIndex(function(r){return r.referenceId===v.source.referenceId&&r.digest===v.source.digest;});src.value=v.source.kind==='owner_estimate'?'owner':sourceIndex<0?'':String(sourceIndex);if(!src.value)el('option','Earlier Source Unavailable — Choose Again',src).value='';src.onchange=function(){var r=src.value==='owner'?null:basis.references[Number(src.value)];v.source.kind=r?r.kind:'owner_estimate';v.source.referenceId=r?r.referenceId:null;v.source.digest=r?r.digest:null;invalidate();};
      var noteLabel=el('label','Why These Changes Are Plausible',fields),note=el('textarea',null,noteLabel);note.maxLength=1000;note.id='cdScenario-'+kind+'-note';note.value=v.source.note;note.oninput=function(){v.source.note=note.value;invalidate();};el('p','A saved reference does not verify these hypothetical amounts. Technical details can be added by the owner or estimator later.',fields);
      [['effectiveOn','Effective Date'],['endsOn','Review By Date']].forEach(function(row){var l=el('label',row[1]+' (Optional)',fields),date=el('input',null,l);date.type='date';date.value=v.source[row[0]]||'';date.oninput=function(){v.source[row[0]]=date.value||null;invalidate();};});
      var consent=el('label',null,fields);consent.className='capella-scenario-check';var check=el('input',null,consent);check.type='checkbox';check.id='cdScenario-'+kind+'-coverage';check.checked=v.overheadSeparate;el('span','The additional overhead excludes expenses already counted in direct costs.',consent);check.onchange=function(){v.overheadSeparate=check.checked;invalidate();};
    });
    var status=el('p',draft.stale?'The estimate or sources changed. Refresh the review before calculating again.':changed?'The saved basis changed. Check your entries and overhead coverage before recalculating.':'',form);status.id='cdScenarioStatus';status.setAttribute('role','status');status.tabIndex=-1;
    var actions=el('div',null,form);actions.className='drawer-review-actions';var calculate=el('button','Calculate Scenarios',actions);calculate.type='submit';calculate.id='cdScenarioCalculate';calculate.className='btn btn-primary';calculate.disabled=!basis.enabled||draft.stale===true;var clear=el('button','Clear Analysis',actions);clear.type='button';clear.className='btn btn-secondary';clear.onclick=function(){_capellaScenarioDraft={key:draft.key,digest:draft.digest,stale:draft.stale===true,price:'',open:true,scenarios:{},result:null};renderCapellaReview(review);var d=$('cdCapellaScenarios');d.open=true;d.querySelector('summary').focus();};
    var results=el('div',null,details);results.id='cdScenarioResults';
    function invalidate(){draft.edit=(draft.edit||0)+1;draft.result=null;results.replaceChildren();status.textContent=draft.stale?'The estimate or sources changed. Refresh the review before calculating again.':'Assumptions changed. Calculate again to update the comparison.';}
    function show(r){results.replaceChildren();el('p',r.priceLabel,results);var rows=el('div',null,results);rows.className='capella-scenario-grid';[{kind:'Base',result:r.base}].concat(r.scenarios).forEach(function(s){var box=el('section',null,rows);el('h4',s.kind.charAt(0).toUpperCase()+s.kind.slice(1),box);var list=el('dl',null,box);[['Modeled Costs',s.result.modeledCosts],['Net Price Before Tax',s.result.netBeforeTax],['Remaining After Modeled Costs',s.result.remaining],['Break-Even Net Price',s.result.breakEven],['Shortfall',s.result.shortfall]].forEach(function(row){var pair=el('div',null,list);el('dt',row[0],pair);var n=row[1];el('dd',typeof n==='string'&&n[0]==='-'?'-'+decisionMoney(n.slice(1),basis.currency):decisionMoney(n,basis.currency),pair);});el('p','Margin: '+(s.result.margin?s.result.margin.value+'%':'Unavailable')+' · Markup: '+(s.result.markup?s.result.markup.value+'%':'Unavailable'),box);if(s.result.policy){el('p','Policy Allowance: '+decisionMoney(s.result.policy.allowance,basis.currency)+' · Policy Budget: '+decisionMoney(s.result.policy.policyBudget,basis.currency),box);el('p','Policy Threshold: '+decisionMoney(s.result.policy.threshold,basis.currency)+' · '+({below:'Below Policy',at:'At Policy',above:'Above Policy',unavailable:'Policy Comparison Unavailable'}[s.result.policy.comparison&&s.result.policy.comparison.status]||'Policy Comparison Unavailable'),box);}else el('p','A current policy comparison is unavailable for this basis.',box);(s.cautions||[]).forEach(function(t){el('p',t,box);});});el('p','Each additional '+decisionMoney('1.00',basis.currency)+' of modeled cost reduces the amount remaining by '+decisionMoney('1.00',basis.currency)+'. Each additional '+decisionMoney('1.00',basis.currency)+' of net price increases it by the same amount. These are arithmetic relationships, not forecasts.',results);el('p',r.limitation,results);}
    if(draft.result)show(draft.result);
    form.onsubmit=function(e){e.preventDefault();var generation=_openSequence,input={basisDigest:basis.digest,priceBasis:draft.price,scenarios:Object.keys(draft.scenarios).filter(function(k){return draft.scenarios[k].active;}).map(function(k){var v=draft.scenarios[k];return{kind:v.kind,directChange:v.directChange,overheadChange:v.overheadChange,priceChange:v.priceChange,overheadSeparate:v.overheadSeparate,source:v.source};})};var body=JSON.stringify(input),edit=draft.edit||0;calculate.disabled=true;status.textContent='Calculating Scenarios…';draft.result=null;results.replaceChildren();
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/'+encodeURIComponent(review.pins.estimateId)+'/capella-scenarios?revision='+encodeURIComponent(review.selectedRevision),{method:'POST',headers:{'Content-Type':'application/json'},body:body}).then(function(response){return response.json().catch(function(){return{};}).then(function(b){if(!response.ok)throw{status:response.status,message:b.error&&b.error.message};return b.data;});}).then(function(r){if(generation!==_openSequence||review!==_estimateReview||draft!==_capellaScenarioDraft)return;if(edit!==(draft.edit||0))return;if(r.basisDigest!==basis.digest)throw{status:409};draft.result=r;show(r);status.textContent='Calculated From Your Unsaved Assumptions. The Estimate Has Not Changed.';}).catch(function(error){if(generation!==_openSequence||review!==_estimateReview||draft!==_capellaScenarioDraft||edit!==(draft.edit||0))return;draft.result=null;results.replaceChildren();if(error.status===409){draft.stale=true;Object.keys(draft.scenarios).forEach(function(k){draft.scenarios[k].overheadSeparate=false;var check=form.querySelector('#cdScenario-'+k+'-coverage');if(check)check.checked=false;});}status.textContent=error.status===409?'The estimate or sources changed. Refresh the review before calculating again.':error.status===413?'Shorten the assumption notes before calculating again.':error.status===401?'Sign in again to calculate scenarios.':error.status===403?'Your current account cannot calculate scenarios.':error.status===404?'This estimate is unavailable. Choose an available estimate.':error.status===410?'This demo session expired. Refresh to start again.':error.status===429?'Scenario analysis is temporarily limited. Wait and try again.':error.status===400&&error.message?error.message:'Scenario analysis is unavailable. Refresh or try calculating again; no estimate changes were saved.';}).finally(function(){if(generation===_openSequence&&review===_estimateReview&&draft===_capellaScenarioDraft){calculate.disabled=!basis.enabled||draft.stale===true;if(edit===(draft.edit||0))status.focus();}});
    };
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
    var commercial=review.commercialTerms;if(commercial){var terms=document.createElement('details');terms.id='cdCapellaCommercial';var title=document.createElement('summary');title.textContent='Commercial Approval';terms.appendChild(title);var note=document.createElement('p');note.textContent=commercial.approvalState==='commercial_approved'?'The current full commercial approval uses the net price before tax. Tax collected is excluded from this cost comparison.':commercial.approvalState==='scope_price_only'?'The current review covers scope and price only. Full commercial terms and tax treatment have not been approved together.':'No current full commercial approval is recorded.';terms.appendChild(note);if(commercial.binding&&commercial.customerSummary){var payable=document.createElement('p');payable.textContent='Total Payable: '+decisionMoney(commercial.customerSummary.total,review.currency)+' · Tax: '+decisionMoney(commercial.customerSummary.tax,review.currency);terms.appendChild(payable);}root.insertBefore(terms,$('cdCapellaRefresh'));}
    var policy=review.pricingPolicyCheck;if(policy){var section=document.createElement('details');section.id='cdCapellaPolicy';var summary=document.createElement('summary');summary.textContent='Pricing Policy Check';section.appendChild(summary);var message=document.createElement('p');message.textContent=policy.message;section.appendChild(message);if(policy.result)renderPricingPolicyResult(policy.result,section,review.currency);root.insertBefore(section,$('cdCapellaRefresh'));}
    renderCapellaScenarios(review,root);
    var readiness=review.equipmentReadiness&&review.equipmentReadiness.current;if(readiness&&readiness.action==='save'&&(readiness.currentSourcesChanged||readiness.result&&readiness.result.status==='blocked'))paragraph('Equipment readiness needs attention. This cost comparison does not establish that the equipment can be used for the job.');
  }

  function refreshEstimateReview(focusReason) {
    if(window.NorthStarPreparedEstimate)window.NorthStarPreparedEstimate.dispose(_preparedEstimateState);
    restoreReviewActions();var root = $('cdEstimateReview'), button = $('cdEstimateReviewRefresh');
    var selected = _currentData && _currentData.canonical;
    var generation = _openSequence, request = ++_reviewSequence;
    var restoreFocus = focusReason === 'capella-refresh' || focusReason === 'adoption-saved' || focusReason === 'revision-selected' || focusReason === 'labor-saved' || focusReason === 'travel-saved' || focusReason === 'material-saved' || focusReason === 'decision-saved' || focusReason === 'review-refresh' || document.activeElement === button || $('cdEstimateDecision').contains(document.activeElement);
    _estimateReview = null; button.disabled = true; $('cdEstimateDecision').replaceChildren();
    renderCapellaStatus('Loading cost comparison.');
    renderTravelStatus('Loading travel plan.');
    root.replaceChildren(); root.textContent = 'Loading estimate review.'; root.setAttribute('aria-busy', 'true');
    root.setAttribute('role','status');root.setAttribute('aria-live','polite');
    button.disabled = true;
    function current() { return generation === _openSequence && request === _reviewSequence && _currentData && _currentData.canonical === selected && !_drawerEl.hidden; }
    function unavailable(message) { root.replaceChildren(); root.textContent = message; renderCapellaStatus(message); renderTravelStatus(message); }
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
        root.replaceChildren();root.removeAttribute('role');root.removeAttribute('aria-live');
        function paragraph(text) { var node = document.createElement('p'); node.style.margin = '0 0 0.75rem'; node.textContent = text; root.appendChild(node); }
        renderRevisionSelector(review,root);
        if (review.simulated) paragraph('Demo example using fictional company and job information.');
        paragraph(review.approvalMessage);
        paragraph(review.basisMessage);
        var date = new Date(review.recordedAt);
        paragraph(Number.isFinite(date.getTime()) ? 'Estimate information recorded ' + date.toLocaleString() + '.' : 'The date of this estimate is unavailable.');
        var list = document.createElement('div'); list.className = 'drawer-pricing-category';list.id='cdEstimateCostRows';list.tabIndex=-1;
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
        var preparedHost=document.createElement('div');root.prepend(preparedHost);
        var savedDetails=document.createElement('details');savedDetails.id='cdPreparedSaved';var savedTitle=document.createElement('summary');savedTitle.textContent='Saved Estimate';savedDetails.appendChild(savedTitle);Array.from(root.childNodes).filter(function(n){return n!==preparedHost;}).forEach(function(n){savedDetails.appendChild(n);});root.appendChild(savedDetails);
        var editPlans=document.createElement('details');editPlans.id='cdPreparedManual';var editTitle=document.createElement('summary');editTitle.textContent='Edit Saved Plans';editPlans.appendChild(editTitle);root.appendChild(editPlans);
        renderGroundedRecommendations(review, editPlans);
        renderMaterialReview(review, editPlans);
        renderLaborPlan(review, editPlans);
        renderPricingPlan(review, editPlans);
        renderPricingPolicy(review, editPlans);
        if(window.NorthStarCommercialTerms)window.NorthStarCommercialTerms.render(review,editPlans,{money:decisionMoney,refresh:function(){refreshEstimateReview('commercial-saved');},isCurrent:function(){return current()&&review===_estimateReview;}});
        renderTravelPlan(review);
        renderEquipmentPlan(review, editPlans);
        renderMaterialAdoption(review, editPlans);
        (review.missing || []).forEach(paragraph);
        if (_decisionDraft && _decisionDraft.basis !== decisionReviewBasis(review)) {
          _decisionDraft.confirmed = false; _decisionDraft.request = null; _decisionDraft.basisChanged = true;
          _decisionDraft.basis = decisionReviewBasis(review);
        }
        _estimateReview = review; renderEstimateDecision(review); renderCapellaReview(review);positionPricingReviewActions();
        if(window.NorthStarPreparedEstimate)_preparedEstimateState=window.NorthStarPreparedEstimate.mount(review,preparedHost,_preparedEstimateState,{money:decisionMoney,refresh:function(){refreshEstimateReview('review-refresh');},isCurrent:function(){return current()&&_estimateReview===review;}});
        var estimateHub=$('cdEstimateHub');if(estimateHub){estimateHub.replaceChildren();estimateHub.hidden=false;if(window.NorthStarCustomerEstimate)window.NorthStarCustomerEstimate.mount(review,estimateHub);}
        if(_groundedReview){
          var handoff=_groundedReview;_groundedReview=null;
          function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object'){var out={};Object.keys(value).sort().forEach(function(k){out[k]=stable(value[k]);});return out;}return value;}
          function handoffWarning(text){var notice=document.createElement('p');notice.id='cdGroundedReviewNotice';notice.textContent=text;notice.setAttribute('role','status');notice.tabIndex=-1;root.appendChild(notice);for(var ancestor=notice;ancestor;ancestor=ancestor.parentElement)if(ancestor.tagName==='DETAILS')ancestor.open=true;notice.focus();notice.scrollIntoView({block:'nearest'});}
          var target=handoff.target, currentHandoffBasis={decisionBasis:review.decisions&&review.decisions.writeBasis||null,plans:{}};
          ['materialPlans','laborPlans','equipmentPlans','travelPlans','equipmentCostPlans','pricingPlans','pricingPolicies','commercialTerms'].forEach(function(key){currentHandoffBasis.plans[key]=review[key]&&review[key].current&&review[key].current.digest||null;});
          if(!target||target.estimateId!==selected.ids.estimate||target.selectedRevision!==review.selectedRevision||JSON.stringify(stable(target.handoffBasis))!==JSON.stringify(stable(currentHandoffBasis))||JSON.stringify(stable(target.sourcePins))!==JSON.stringify(stable(review.pins))){handoffWarning('The estimate changed since this conversation. Review its current details before making changes.');}
          else {
            var proposal=handoff.proposal;
            if(proposal&&proposal.change){
              var saved=review.laborPlans&&review.laborPlans.current,change=proposal.change;
              var line=saved&&saved.inputs&&saved.inputs.lines[change.index];
              if(proposal.editor!=='labor'||!review.laborPlans||!review.laborPlans.canMutate||!saved||saved.digest!==proposal.planDigest||!line||line.lineId!==change.lineId||line.basis!=='worker_hours'||change.field!=='workerHours'||change.source!=='explicit_user_assumption'||line.workerHours!==change.previous||! /^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$/.test(change.value)){handoffWarning('The proposed task changed. Review the current labor plan before entering a new assumption.');return;}
              var proposedInputs=JSON.parse(JSON.stringify(saved.inputs));proposedInputs.assessment=null;proposedInputs.lines[change.index].workerHours=change.value;proposedInputs.lines[change.index].quantitySource={kind:'my_estimate',reference:'',note:'Work time proposed by the reviewer in Polaris; requires review.',effectiveOn:null,endsOn:null,geography:''};
              _laborPlanDraft={estimateId:review.pins.estimateId,basis:JSON.stringify([review.pins,saved.digest,review.laborPlans.decisionBasis]),action:'save',inputs:proposedInputs,reason:'',confirmed:false,result:null,request:null,explanation:''};
              var laborRoot=$('cdLaborPlan'),laborParent=laborRoot.parentElement;laborRoot.remove();renderLaborPlan(review,laborParent);
            }
            var ids={capella:'cdCapellaReview',estimate_review:'cdEstimateReview',material:'cdMaterialPlan',labor:'cdLaborPlan',equipment:'cdEquipmentPlan',travel:'cdTravelPlan'},destination=$(ids[handoff.editor]);
            if(destination){for(var ancestor=destination;ancestor;ancestor=ancestor.parentElement)if(ancestor.tagName==='DETAILS')ancestor.open=true;destination.tabIndex=-1;destination.focus();destination.scrollIntoView({block:'nearest'});}
          }
        }

      }).catch(function(error) {
        if (!current()) return;
        unavailable(error.status === 401 ? 'Sign in again to review this estimate.' : error.status === 403 ?
          'Estimate review is available to current owners and administrators.' : error.status === 404 ?
          'This estimate is no longer available. Reopen the customer to try again.' : 'Estimate review could not be loaded. Try refreshing it.');
      }).finally(function() { if (current()) { root.setAttribute('aria-busy', 'false'); button.disabled = false; if ($('cdCapellaRefresh')) $('cdCapellaRefresh').disabled=false; if (restoreFocus) { if (focusReason === 'capella-refresh' && $('cdCapellaRefresh')) $('cdCapellaRefresh').focus(); else if (focusReason === 'travel-saved') { var travel=$('cdTravelPlan');if(travel){for(var x=travel;x;x=x.parentElement)if(x.tagName==='DETAILS')x.open=true;var action=$('cdTravelStart');if(action)action.focus();else button.focus();}} else if (focusReason === 'labor-saved') { var labor=$('cdLaborPlan');if(labor){for(var x=labor;x;x=x.parentElement)if(x.tagName==='DETAILS')x.open=true;var action=labor.querySelector('#cdLaborStart');if(action)action.focus();else button.focus();}} else if (focusReason === 'material-saved') { var material=$('cdMaterialReview');if(material){for(var x=material;x;x=x.parentElement)if(x.tagName==='DETAILS')x.open=true;var action=material.querySelector('#cdMaterialPlan button');if(action)action.focus();else button.focus();} } else if (focusReason === 'decision-saved' || focusReason === 'adoption-saved') focusDecisionAction('approve'); else if(focusReason==='revision-selected'&&$('cdEstimateRevisionSelect')){var selector=$('cdEstimateRevisionSelect');for(var x=selector;x;x=x.parentElement)if(x.tagName==='DETAILS')x.open=true;selector.focus();} else button.focus(); } } });
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
    if(window.NorthStarPreparedEstimate)window.NorthStarPreparedEstimate.dispose(_preparedEstimateState);_preparedEstimateState=null;
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
