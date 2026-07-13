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
    var clickAttr = options.onclick ? ' onclick="' + options.onclick + '"' : '';
    var clickStyle = options.onclick ? 'cursor:pointer;' : '';

    return '<div class="ds-list-item" style="' + clickStyle + '"' + clickAttr + '>' +
      '<div class="ds-list-item-icon">' + icon + '</div>' +
      '<div class="ds-list-item-content">' +
        '<div class="ds-list-item-title">' + name + '</div>' +
        '<div class="ds-list-item-sub">' + svc + ' · ' + time + '</div>' +
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
    var index = options.index !== undefined ? options.index : 0;

    var pbHtml = '';
    if (lead.pricingBreakdown && Array.isArray(lead.pricingBreakdown) && lead.pricingBreakdown.length > 0) {
      pbHtml = '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--neutral-300);max-height:80px;overflow-y:auto;">' +
        '<div style="font-size:12px;font-weight:600;color:var(--neutral-700);margin-bottom:6px;">Pricing Breakdown</div>';
      lead.pricingBreakdown.forEach(function(pb) {
        pbHtml += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid var(--neutral-100);">' +
          '<span>' + pb.l + '</span>' +
          '<span style="font-weight:' + (pb.l === 'Total' ? '700' : '400') + ';color:var(--neutral-700);">$' + Math.abs(pb.a).toLocaleString() + '</span>' +
        '</div>';
      });
      pbHtml += '</div>';
    }

    return '<div class="call-card" id="call-' + index + '">' +
      '<div class="call-card-header" data-lead-index="' + index + '" onclick="openCallCard(this)">' +
        '<div class="call-caller">' +
          '<div class="call-avatar">' + inits + '</div>' +
          '<div class="call-info">' +
            '<div class="call-name">' + name + '</div>' +
            '<div class="call-meta">' + time + ' <span class="meta-sep">|</span> ' + duration + ' <span class="meta-sep">|</span> ' + svc + '</div>' +
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
    var index = options.index !== undefined ? options.index : 0;

    return '<tr style="cursor:pointer;" data-lead-index="' + index + '" onclick="openLeadDrawer(this)">' +
      '<td><strong>' + name + '</strong></td>' +
      '<td>' + phone + '</td>' +
      '<td style="text-align:center"><span class="lead-service-badge">' + svc + '</span></td>' +
      '<td><strong>' + val + '</strong></td>' +
      '<td>' + time + '</td>' +
      '<td>' + statusHtml + '</td>' +
      '<td class="lead-actions-cell">' +
        '<div class="more-menu-container">' +
          '<button class="more-btn" onclick="event.stopPropagation(); toggleMoreMenu(this)" title="Actions">•••</button>' +
          '<div class="more-dropdown">' +
            '<button class="more-dropdown-item" onclick="event.stopPropagation(); closeAllMenus(); openLeadDrawer(this.closest(\'tr\'))">👁️ View Details</button>' +
            '<button class="more-dropdown-item" onclick="event.stopPropagation(); closeAllMenus(); updateLeadStatus(' + index + ', \'contacted\')">📞 Mark Contacted</button>' +
            '<button class="more-dropdown-item" onclick="event.stopPropagation(); closeAllMenus(); updateLeadStatus(' + index + ', \'scheduled\')">📅 Schedule</button>' +
            '<button class="more-dropdown-item" onclick="event.stopPropagation(); closeAllMenus(); updateLeadStatus(' + index + ', \'completed\')">✅ Mark Completed</button>' +
            '<button class="more-dropdown-item" style="opacity:0.5;pointer-events:none;" onclick="event.stopPropagation()">🔧 Assign Technician</button>' +
            '<button class="more-dropdown-item" style="opacity:0.5;pointer-events:none;" onclick="event.stopPropagation()">📁 Archive</button>' +
            '<button class="more-dropdown-item danger" onclick="event.stopPropagation(); closeAllMenus(); removeLead(' + index + ')">🗑️ Delete</button>' +
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