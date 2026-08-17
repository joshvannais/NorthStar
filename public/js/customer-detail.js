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

  // ── Helpers ──

  function $(id) { return document.getElementById(id); }

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
    html += '<div class="drawer-overlay" id="cdDrawerOverlay"></div>';
    html += '<div class="customer-drawer" id="cdCustomerDrawer" role="dialog" aria-modal="true" aria-labelledby="cdDrawerTitle" tabindex="-1">';
    html += '  <div class="drawer-header">';
    html += '    <h2 id="cdDrawerTitle">Customer Details</h2>';
    html += '    <button class="drawer-close drawer-close-btn" id="cdDrawerClose" type="button" aria-label="Close customer details">&times;</button>';
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
    html += '        <div id="cdNavigationLauncher"></div>';
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
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Estimated Value</span><span class="drawer-detail-value" id="cdEstValue">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Opportunity Stage</span><span class="drawer-detail-value" id="cdStage">\u2014</span></div>';
    html += '        <div class="drawer-detail-row"><span class="drawer-detail-label">Close Probability</span><span class="drawer-detail-value" id="cdProb">\u2014</span></div>';
    html += '        <div class="drawer-work-details" aria-label="Readable customer and work details">';
    html += '          <section class="drawer-work-detail"><h4>Description</h4><p id="cdDescription">No customer or work description has been recorded.</p></section>';
    html += '          <section class="drawer-work-detail"><h4>Gates and missing information</h4><p id="cdWorkGates">No missing-input guidance is recorded.</p></section>';
    html += '          <section class="drawer-work-detail"><h4>Materials</h4><p id="cdWorkMaterials">Material requirements are unavailable because they have not been recorded.</p></section>';
    html += '          <section class="drawer-work-detail"><h4>Equipment</h4><p id="cdWorkEquipment">Equipment requirements are unavailable because they have not been recorded.</p></section>';
    html += '          <section class="drawer-work-detail"><h4>Scheduling</h4><p id="cdWorkScheduling">Scheduling inputs are unavailable because they have not been recorded.</p></section>';
    html += '          <section class="drawer-work-detail"><h4>Pricing</h4><p id="cdWorkPricing">Pricing is unavailable because a role-authorized estimate has not been recorded.</p></section>';
    html += '          <section class="drawer-work-detail"><h4>Risk</h4><p id="cdWorkRisk">No specific risk is supported by the current recorded inputs.</p></section>';
    html += '        </div>';
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
    html += '          <details class="drawer-polaris-pricing">';
    html += '            <summary>Pricing Breakdown And Supporting Factors</summary>';
    html += '            <div id="cdPricingBreakdown"><p>No role-authorized estimate factors are available.</p></div>';
    html += '          </details>';
    html += '        </div>';
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

  // ── Data Fetching ──

  function _authHeaders() {
    return {};
  }

  function _authFetch(url) {
    return window.NorthStarAccountSession.fetch(url, { headers: _authHeaders() }).then(function(r) { return r.json(); });
  }

  function fetchAll(customerId) {
    if (!window.CanonicalIntelligence) return Promise.reject(new Error('Canonical intelligence client is unavailable.'));
    var filters = { customerId: customerId };
    return Promise.all([
      window.CanonicalIntelligence.loadCompatibility('customer-detail', filters),
      window.CanonicalIntelligence.loadCompatibility('leads', filters),
      window.CanonicalIntelligence.loadCompatibility('estimates', filters),
      window.CanonicalIntelligence.loadCompatibility('communications', filters)
    ]).then(function(results) {
      var digest = results[0].digest;
      if (results.some(function(projection) { return projection.digest !== digest; })) {
        throw new Error('Canonical customer projections do not share one graph digest.');
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
      summary: presentation.serviceText || 'Canonical service',
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
    if (!estimates || estimates.length === 0) {
      return '<p>Pricing factors are not available because no role-authorized estimate has been recorded.</p>';
    }
    var est = estimates[0];
    var presentation = window.PolarisEngine && window.PolarisEngine.selectPresentation(est.canonical);
    var values = presentation && presentation.values;
    if (values && Array.isArray(values.pricingLineItems) && values.pricingLineItems.length > 0) {
      var html = '';
      values.pricingLineItems.forEach(function(item) {
        var amt = item.customerCharge;
        var label = item.label || item.code || 'Item';
        html += '<div class="drawer-pricing-item"><span>' + escapeText(label) + '</span> <span>' + escapeText(fmtCurrency(amt)) + '</span></div>';
      });
      html += '<div class="drawer-pricing-item"><span><strong>Subtotal</strong></span> <span><strong>' + fmtCurrency(values.subtotalBeforeTax) + '</strong></span></div>';
      if (values.taxDisposition && values.taxDisposition.status === 'calculated') {
        html += '<div class="drawer-pricing-item"><span>Tax</span> <span>' + fmtCurrency(values.tax) + '</span></div>';
        html += '<div class="drawer-pricing-item"><span><strong>Total</strong></span> <span><strong>' + fmtCurrency(values.totalIncludingTax) + '</strong></span></div>';
      } else {
        html += '<div class="drawer-pricing-item"><span>Tax</span> <span>Unavailable because ' + escapeText(describe(values.taxDisposition && values.taxDisposition.reason, 'tax configuration has not been recorded', 'reason').toLowerCase()) + '.</span></div>';
      }
      return html;
    }
    if (presentation && presentation.customerPrice !== null) {
      return '<p>Recorded Customer Estimate: <strong>' + presentation.customerPriceRoundedText + '</strong>. A more detailed factor breakdown requires recorded labor, material, equipment, travel, tax, and margin inputs.</p>';
    }
    return '<p>Pricing factors are not available because the required estimate inputs have not been recorded.</p>';
  }

  // ── Public API ──

  function open(customerId) {
    if (!customerId) return;

    // Ensure drawer HTML is injected
    injectDrawerHTML();
    _returnFocus = document.activeElement && typeof document.activeElement.focus === 'function'
      ? document.activeElement : null;

    // Show loading
    _overlayEl.classList.add('open');
    _drawerEl.classList.add('open');
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
      $('cdDrawerLoading').innerHTML = '<p style="color:var(--danger, #ef4444);">Failed to load customer data. Please try again.</p>';
    });
  }

  function populateDrawer(data) {
    $('cdDrawerLoading').style.display = 'none';
    $('cdDrawerContent').style.display = '';
    $('cdDrawerTitle').textContent = data.name || 'Customer Details';

    // Contact Information
    $('cdName').textContent = data.name || 'Unavailable — no customer name is recorded.';
    $('cdPhone').textContent = data.phone || 'Unavailable — no phone number is recorded.';
    $('cdEmail').textContent = data.email || 'Unavailable — no email address is recorded.';
    var canonicalAddress = typeof data.address === 'string' && data.address.trim()
      ? data.address
      : null;
    var navigationRoot = $('cdNavigationLauncher');
    var navigationLauncher = typeof NorthStarNavigationLauncher === 'undefined'
      ? null
      : NorthStarNavigationLauncher;
    $('cdAddress').textContent = canonicalAddress || 'Address unavailable';
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
        : 'Address unavailable';
    }

    // Customer Profile
    $('cdProfileStatus').innerHTML = getStatusBadge(data.status || 'active');
    $('cdProfileJobs').textContent = data.totalJobs == null
      ? 'Unavailable — no completed-job count is recorded.'
      : data.totalJobs;
    $('cdProfileRevenue').textContent = fmtCurrency(data.totalRevenue);
    $('cdProfileLastInteraction').textContent = fmtDate(data.lastInteraction);

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
  }

  function close() {
    if (_overlayEl) _overlayEl.classList.remove('open');
    if (_drawerEl) _drawerEl.classList.remove('open');
    document.body.style.overflow = '';
    _currentData = null;
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
