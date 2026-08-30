/**
 * CustomerCard — Shared Customer Card Renderer
 * Single source of truth for customer card rendering across all pages.
 *
 * Usage:
 *   CustomerCard.render(lead)                  → compact ds-list-item (Dashboard)
 *   CustomerCard.render(lead, {layout:'call'})  → call-card format (Communications)
 *   CustomerCard.render(lead, {layout:'row'})   → table row (All Leads)
 *   CustomerCard.render(lead, {icon:'📞'})      → compact with phone icon
 *   CustomerCard.render(lead, {onclick: fn})    → compact with click handler
 *
 * Common formatting helpers are also exposed for custom use:
 *   CustomerCard.formatName(lead)
 *   CustomerCard.formatService(lead)
 *   CustomerCard.formatTime(lead)
 *   CustomerCard.formatValue(lead)
 *   CustomerCard.getInitials(lead)
 *   CustomerCard.getStatusBadge(status)
 */
window.CustomerCard = (function() {
  var callbackSequence = 0;
  var callbacks = Object.create(null);

  function escapeMarkup(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character];
    });
  }

  function normalizedIndex(value) {
    var parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  function installDelegatedActions() {
    document.addEventListener('click', function(event) {
      var trigger = event.target.closest('[data-customer-card-action]');
      if (!trigger) return;
      var action = trigger.getAttribute('data-customer-card-action');
      var index = normalizedIndex(trigger.getAttribute('data-lead-index'));
      if (action === 'open-call' && typeof window.openCallCard === 'function') {
        window.openCallCard(trigger);
      } else if (action === 'open-lead' && typeof window.openLeadDrawer === 'function') {
        window.openLeadDrawer(trigger);
      } else if (action === 'toggle-more' && typeof window.toggleMoreMenu === 'function') {
        event.preventDefault();
        event.stopPropagation();
        window.toggleMoreMenu(trigger);
      } else if (action === 'view-details' && typeof window.openLeadDrawer === 'function') {
        event.preventDefault();
        event.stopPropagation();
        if (typeof window.closeAllMenus === 'function') window.closeAllMenus();
        window.openLeadDrawer(trigger.closest('tr'));
      } else if (action === 'update-status' && typeof window.updateLeadStatus === 'function') {
        event.preventDefault();
        event.stopPropagation();
        if (typeof window.closeAllMenus === 'function') window.closeAllMenus();
        window.updateLeadStatus(index, trigger.getAttribute('data-lead-status'));
      } else if (action === 'remove-lead' && typeof window.removeLead === 'function') {
        event.preventDefault();
        event.stopPropagation();
        if (typeof window.closeAllMenus === 'function') window.closeAllMenus();
        window.removeLead(index);
      } else if (action === 'callback') {
        var callback = callbacks[trigger.getAttribute('data-customer-card-callback')];
        if (typeof callback === 'function') callback.call(trigger, event);
      }
    });
    document.addEventListener('keydown', function(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var trigger = event.target.closest('[data-customer-card-action][role="button"]');
      if (!trigger) return;
      event.preventDefault();
      trigger.click();
    });
  }

  installDelegatedActions();

  // ─── Common Formatting Helpers ─────────────────────────────────
  function fmtTime(dateVal) {
    if (!dateVal) return 'Not recorded';
    try {
      var d = new Date(dateVal);
      if (isNaN(d.getTime())) return 'Not recorded';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch(e) { return 'Not recorded'; }
  }

  function safe(val, fallback) {
    return (val && val !== 'undefined' && val !== 'null') ? val : (fallback || '');
  }

  function formatName(lead) {
    return safe(lead.caller || lead.customerName, 'Customer name not recorded');
  }

  function formatService(lead) {
    return safe(lead.service || lead.serviceRequested, 'Service not recorded');
  }

  function formatTime(lead) {
    return fmtTime(lead.time || (lead.receivedAt ? lead.receivedAt : null));
  }

  function formatValue(lead) {
    var value = Number(lead.avgPrice);
    return lead.avgPrice !== null && lead.avgPrice !== undefined && lead.avgPrice !== '' && Number.isFinite(value) && value >= 0
      ? '$' + Math.round(value).toLocaleString()
      : 'Unavailable';
  }

  function getInitials(lead) {
    var name = lead.caller || lead.customerName || 'Unknown';
    return name.split(' ').map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
  }

  function getStatusBadge(status, options) {
    if (typeof StatusPill !== 'undefined' && StatusPill.render) {
      return StatusPill.render(status, options);
    }
    status = String(status || 'new').trim().toLowerCase().replace(/_/g, '-');
    var map = { new:'answered', scheduled:'booked', contacted:'estimate', 'follow-up':'followup', completed:'completed', won:'won', lost:'lost', voicemail:'voicemail', 'no-interest':'nointerest', answered:'answered' };
    var cls = map[status] || 'answered';
    var label = status.split('-').filter(Boolean).map(function(part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(' ') || 'New';
    return '<span class="call-status-badge ' + cls + '">' + escapeMarkup(label) + '</span>';
  }

  function communicationKind(value) {
    var normalized = String(value || 'call').trim().toLowerCase().replace(/[_\s]+/g, '-');
    if (normalized === 'sms' || normalized === 'text' || normalized === 'email' || normalized === 'message') {
      return { key:'message', label:'Message', icon:'<path d="M4 5h16v11H8l-4 3V5Z"/><path d="M8 9h8M8 12h5"/>' };
    }
    if (normalized === 'summary' || normalized === 'call-summary') {
      return { key:'summary', label:'Summary', icon:'<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>' };
    }
    if (normalized === 'follow-up' || normalized === 'followup') {
      return { key:'follow-up', label:'Follow-up', icon:'<path d="M4 12h12"/><path d="m12 7 5 5-5 5"/><path d="M20 5v14"/>' };
    }
    return { key:'call', label:'Call', icon:'<path d="M6 3h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4c0 2-2 3-4 3C9 20 4 15 3 7c0-2 1-4 3-4Z"/>' };
  }

  function communicationKinds(lead) {
    var values = Array.isArray(lead.communicationKinds) && lead.communicationKinds.length
      ? lead.communicationKinds : [lead.communicationType || lead.type || 'call'];
    var seen = Object.create(null);
    return values.map(communicationKind).filter(function(kind) {
      if (seen[kind.key]) return false;
      seen[kind.key] = true;
      return true;
    });
  }

  // ─── Render Functions ──────────────────────────────────────────

  /**
   * Main render function — single entry point for all pages.
   * @param {Object} lead - The lead/customer data object
   * @param {Object} [options] - Rendering options
   * @param {string} [options.layout='compact'] - Layout: 'compact', 'call', 'row'
   * @param {string} [options.icon] - Icon override for compact layout (👤 or 📞)
   * @param {Function} [options.onclick] - Click handler for compact layout
   * @param {number} [options.index] - Lead index for row layout
   * @param {string} [options.outcome] - Outcome value for Communications page
   * @returns {string} HTML string
   */
  function render(lead, options) {
    options = options || {};
    var layout = options.layout || 'compact';
    if (layout === 'call') return renderCallCard(lead, options);
    if (layout === 'row') return renderTableRow(lead, options);
    return renderCompact(lead, options);
  }

  /**
   * Compact ds-list-item layout — used by Dashboard Recent Leads & Recent Calls
   */
  function renderCompact(lead, options) {
    options = options || {};
    var icon = options.icon || '👤';
    var name = formatName(lead);
    var svc = formatService(lead);
    var time = formatTime(lead);
    var statusHtml = getStatusBadge(lead.status || 'new');
    var clickAttr = '';
    var clickStyle = '';
    if (typeof options.onclick === 'function') {
      callbackSequence += 1;
      var callbackId = 'customer-card-' + callbackSequence;
      callbacks[callbackId] = options.onclick;
      clickAttr = ' data-customer-card-action="callback" data-customer-card-callback="' + callbackId + '"';
      clickStyle = 'cursor:pointer;';
    }

    return '<div class="ds-list-item" style="' + clickStyle + '"' + clickAttr + '>' +
      '<div class="ds-list-item-icon">' + escapeMarkup(icon) + '</div>' +
      '<div class="ds-list-item-content">' +
        '<div class="ds-list-item-title">' + escapeMarkup(name) + '</div>' +
        '<div class="ds-list-item-sub">' + escapeMarkup(svc) + ' · ' + escapeMarkup(time) + '</div>' +
      '</div>' +
      '<div>' + statusHtml + '</div>' +
    '</div>';
  }

  /**
   * Call card layout — used by Communications page
   */
  function renderCallCard(lead, options) {
    options = options || {};
    var name = formatName(lead);
    var svc = formatService(lead);
    var time = formatTime(lead);
    var inits = getInitials(lead);
    var duration = safe(lead.duration, '');
    // Use outcome for status badge if provided, otherwise use lead status
    var statusVal = options.outcome || lead.status || 'new';
    var statusOpts = {type: 'outcome', leadStatus: lead.status};
    var statusHtml = getStatusBadge(statusVal, statusOpts);
    var index = normalizedIndex(options.index);
    var metaItems = [time, duration, svc].filter(function(value) {
      return value && value !== '\u2014' && value !== '-' && value !== 'undefined' && value !== 'null';
    });
    var metaHtml = metaItems.map(function(value) {
      return '<span class="call-meta-item">' + escapeMarkup(value) + '</span>';
    }).join('');
    var kindHtml = communicationKinds(lead).map(function(kind) {
      return '<span class="communication-kind" data-communication-kind="' + escapeMarkup(kind.key) + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + kind.icon + '</svg>' + escapeMarkup(kind.label) + '</span>';
    }).join('');

    return '<div class="call-card" id="call-' + index + '">' +
      '<div class="call-card-header" data-customer-card-action="open-call" data-lead-index="' + index + '" role="button" tabindex="0" aria-label="Open details for ' + escapeMarkup(name) + '">' +
        '<div class="call-caller">' +
          '<div class="call-avatar">' + escapeMarkup(inits) + '</div>' +
          '<div class="call-info">' +
            '<div class="call-name">' + escapeMarkup(name) + '</div>' +
            '<div class="call-meta">' + metaHtml + '</div>' +
            '<div class="communication-kind-list" aria-label="Communication types">' + kindHtml + '</div>' +
          '</div>' +
        '</div>' +
        statusHtml +
      '</div>' +
    '</div>';
  }

  /**
   * Table row layout — used by All Leads page
   */
  function renderTableRow(lead, options) {
    options = options || {};
    var name = formatName(lead);
    var svc = formatService(lead);
    var time = formatTime(lead);
    var val = formatValue(lead);
    var phone = safe(lead.phone || lead.phoneNumber, 'Not recorded');
    var statusHtml = getStatusBadge(lead.status || 'new');
    var index = normalizedIndex(options.index);
    var unavailableActionsId = 'northstarUnavailableLeadActions-' + index;

    return '<tr style="cursor:pointer;" data-customer-card-action="open-lead" data-lead-index="' + index + '" role="button" tabindex="0" aria-label="Open details for ' + escapeMarkup(name) + '">' +
      '<td data-label="Customer"><strong>' + escapeMarkup(name) + '</strong></td>' +
      '<td data-label="Phone">' + escapeMarkup(phone) + '</td>' +
      '<td data-label="Service" style="text-align:center"><span class="lead-service-badge">' + escapeMarkup(svc) + '</span></td>' +
      '<td data-label="Estimated value"><strong>' + escapeMarkup(val) + '</strong></td>' +
      '<td data-label="Date">' + escapeMarkup(time) + '</td>' +
      '<td data-label="Status">' + statusHtml + '</td>' +
      '<td class="lead-actions-cell" data-label="Actions">' +
        '<div class="more-menu-container">' +
          '<button class="more-btn" data-customer-card-action="toggle-more" title="Actions" aria-label="Actions for ' + escapeMarkup(name) + '">•••</button>' +
          '<div class="more-dropdown">' +
            '<button class="more-dropdown-item" data-customer-card-action="view-details">👁️ View Details</button>' +
            '<button class="more-dropdown-item" data-customer-card-action="update-status" data-lead-index="' + index + '" data-lead-status="contacted">📞 Mark Contacted</button>' +
            '<button class="more-dropdown-item" data-customer-card-action="update-status" data-lead-index="' + index + '" data-lead-status="scheduled">📅 Schedule</button>' +
            '<button class="more-dropdown-item" data-customer-card-action="update-status" data-lead-index="' + index + '" data-lead-status="completed">✅ Mark Completed</button>' +
            '<span class="sr-only" id="' + unavailableActionsId + '">These actions require assignment and archive authorities that are not available on this read-only lead list.</span>' +
            '<button class="more-dropdown-item" disabled aria-describedby="' + unavailableActionsId + '" title="Requires assignment authority">Assign Technician</button>' +
            '<button class="more-dropdown-item" disabled aria-describedby="' + unavailableActionsId + '" title="Requires archive authority">Archive</button>' +
            '<button class="more-dropdown-item danger" data-customer-card-action="remove-lead" data-lead-index="' + index + '">🗑️ Delete</button>' +
          '</div>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  return {
    render: render,
    formatName: formatName,
    formatService: formatService,
    formatTime: formatTime,
    formatValue: formatValue,
    getInitials: getInitials,
    getStatusBadge: getStatusBadge
  };
})();
