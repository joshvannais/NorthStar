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
  }

  installDelegatedActions();

  // ─── Common Formatting Helpers ─────────────────────────────────
  function fmtTime(dateVal) {
    if (!dateVal) return '—';
    try {
      var d = new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch(e) { return String(dateVal); }
  }

  function safe(val, fallback) {
    return (val && val !== 'undefined' && val !== 'null') ? val : (fallback || '');
  }

  function formatName(lead) {
    return safe(lead.caller || lead.customerName, 'Unknown');
  }

  function formatService(lead) {
    return safe(lead.service || lead.serviceRequested, '—');
  }

  function formatTime(lead) {
    return fmtTime(lead.time || (lead.receivedAt ? lead.receivedAt : null));
  }

  function formatValue(lead) {
    return lead.avgPrice ? '$' + Math.round(lead.avgPrice).toLocaleString() : '—';
  }

  function getInitials(lead) {
    var name = lead.caller || lead.customerName || 'Unknown';
    return name.split(' ').map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
  }

  function getStatusBadge(status, options) {
    if (typeof StatusPill !== 'undefined' && StatusPill.render) {
      return StatusPill.render(status, options);
    }
    status = status || 'new';
    var map = { new:'answered', scheduled:'booked', contacted:'estimate', 'follow-up':'followup', completed:'completed', won:'won', lost:'lost', voicemail:'voicemail', 'no-interest':'nointerest', answered:'answered' };
    var cls = map[status.toLowerCase()] || 'answered';
    var label = status.charAt(0).toUpperCase() + status.slice(1);
    return '<span class="call-status-badge ' + cls + '">' + label + '</span>';
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

    var pbHtml = '';
    if (lead.pricingBreakdown && Array.isArray(lead.pricingBreakdown) && lead.pricingBreakdown.length > 0) {
      pbHtml = '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--neutral-300);max-height:80px;overflow-y:auto;">' +
        '<div style="font-size:12px;font-weight:600;color:var(--neutral-700);margin-bottom:6px;">Pricing Breakdown</div>';
      lead.pricingBreakdown.forEach(function(pb) {
        pbHtml += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid var(--neutral-100);">' +
          '<span>' + escapeMarkup(pb.l) + '</span>' +
          '<span style="font-weight:' + (pb.l === 'Total' ? '700' : '400') + ';color:var(--neutral-700);">$' + Math.abs(pb.a).toLocaleString() + '</span>' +
        '</div>';
      });
      pbHtml += '</div>';
    }

    return '<div class="call-card" id="call-' + index + '">' +
      '<div class="call-card-header" data-customer-card-action="open-call" data-lead-index="' + index + '">' +
        '<div class="call-caller">' +
          '<div class="call-avatar">' + escapeMarkup(inits) + '</div>' +
          '<div class="call-info">' +
            '<div class="call-name">' + escapeMarkup(name) + '</div>' +
            '<div class="call-meta">' + escapeMarkup(time) + ' <span class="meta-sep">|</span> ' + escapeMarkup(duration) + ' <span class="meta-sep">|</span> ' + escapeMarkup(svc) + '</div>' +
          '</div>' +
        '</div>' +
        statusHtml +
      '</div>' +
      '<div class="call-card-body">' +
        '<p style="padding:12px;text-align:center;color:var(--neutral-500);font-size:13px;">Click to view full customer details, POLARIS analysis, and transcript.</p>' +
        pbHtml +
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
    var phone = safe(lead.phone || lead.phoneNumber, '-');
    var statusHtml = getStatusBadge(lead.status || 'new');
    var index = normalizedIndex(options.index);

    return '<tr style="cursor:pointer;" data-customer-card-action="open-lead" data-lead-index="' + index + '">' +
      '<td><strong>' + escapeMarkup(name) + '</strong></td>' +
      '<td>' + escapeMarkup(phone) + '</td>' +
      '<td style="text-align:center"><span class="lead-service-badge">' + escapeMarkup(svc) + '</span></td>' +
      '<td><strong>' + escapeMarkup(val) + '</strong></td>' +
      '<td>' + escapeMarkup(time) + '</td>' +
      '<td>' + statusHtml + '</td>' +
      '<td class="lead-actions-cell">' +
        '<div class="more-menu-container">' +
          '<button class="more-btn" data-customer-card-action="toggle-more" title="Actions">•••</button>' +
          '<div class="more-dropdown">' +
            '<button class="more-dropdown-item" data-customer-card-action="view-details">👁️ View Details</button>' +
            '<button class="more-dropdown-item" data-customer-card-action="update-status" data-lead-index="' + index + '" data-lead-status="contacted">📞 Mark Contacted</button>' +
            '<button class="more-dropdown-item" data-customer-card-action="update-status" data-lead-index="' + index + '" data-lead-status="scheduled">📅 Schedule</button>' +
            '<button class="more-dropdown-item" data-customer-card-action="update-status" data-lead-index="' + index + '" data-lead-status="completed">✅ Mark Completed</button>' +
            '<button class="more-dropdown-item" style="opacity:0.5;pointer-events:none;">🔧 Assign Technician</button>' +
            '<button class="more-dropdown-item" style="opacity:0.5;pointer-events:none;">📁 Archive</button>' +
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
