/**
 * customer-drawer.js — Shared Customer Record View
 *
 * The SINGLE authoritative customer record view for the entire NorthStar
 * platform. Every page (Leads, Communications, Dashboard) calls
 * CustomerDrawer.open(lead) to view ANY customer record.
 *
 * Dependencies:
 *   - PolarisEngine (from polaris-engine.js)
 *   - getStatusBadge() (from api.js)
 *
 * CSS dependencies (in style.css):
 *   .drawer-overlay, .customer-drawer, .drawer-header, .drawer-close,
 *   .drawer-body, .drawer-section, .drawer-detail-row, .drawer-transcript,
 *   .drawer-pricing-item, .drawer-polaris-insight, .drawer-description-box
 */

var CustomerDrawer = (function() {
  'use strict';

  var currentLead = null;

  // —— Private helpers ——

  function fmtTime(t) {
    if (!t) return '—';
    try {
      var d = new Date(t);
      if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch(e) {}
    return t;
  }

  function capitalizeFirst(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function generatePolarisInsight(lead) {
    try {
      if (typeof PolarisEngine !== 'undefined' && PolarisEngine.analyzeLead) {
        var result = PolarisEngine.analyzeLead(lead);
        return result.insight || result;
      }
    } catch(e) {}
    return lead.polarisAnalysis ? (lead.polarisAnalysis.insight || 'Analysis available.') : 'No insight available.';
  }

  function formatTranscript(t, callerName) {
    if (!t) return 'No transcript available for this lead.';
    try {
      return t.split('\n').map(function(l) {
        if (l.startsWith('AI:')) return '<div class="transcript-line transcript-ai"><span class="transcript-speaker">AI</span> ' + l.substring(3) + '</div>';
        if (l.startsWith('Customer:')) return '<div class="transcript-line transcript-customer"><span class="transcript-speaker">' + (callerName || 'Customer').split(' ')[0] + '</span> ' + l.substring(9) + '</div>';
        return '<div class="transcript-line">' + l + '</div>';
      }).join('');
    } catch(e) { return t; }
  }

  function safeGet(id) {
    var el = document.getElementById(id);
    if (!el) console.warn('CustomerDrawer: element #' + id + ' not found');
    return el;
  }

  // —— Public API ——

  /**
   * Open the customer drawer and populate it with lead data.
   * @param {Object} lead - A lead/customer object with standard fields
   */
  function open(lead) {
    if (!lead) return;
    currentLead = lead;

    var nameEl = safeGet('drawerName');
    var phoneEl = safeGet('drawerPhone');
    var addressEl = safeGet('drawerAddress');
    var serviceEl = safeGet('drawerService');
    var descEl = safeGet('drawerDescription');
    var valueEl = safeGet('drawerValue');
    var statusEl = safeGet('drawerStatus');
    var dateEl = safeGet('drawerDate');
    var polarisEl = safeGet('drawerPolarisInsight');
    var pbEl = safeGet('drawerPricingBreakdown');
    var transcriptEl = safeGet('drawerTranscript');
    var overlayEl = safeGet('drawerOverlay');
    var drawerEl = safeGet('customerDrawer');

    if (nameEl) nameEl.textContent = lead.caller || lead.customerName || '—';
    if (phoneEl) phoneEl.textContent = lead.phone || lead.phoneNumber || '—';
    if (addressEl) addressEl.textContent = lead.address || '—';
    if (serviceEl) serviceEl.textContent = lead.service || lead.serviceRequested || '—';

    var desc = lead.jobDetail || lead.summary || '';
    if (descEl) descEl.textContent = desc ? capitalizeFirst(desc) : '—';
    if (valueEl) valueEl.textContent = lead.avgPrice ? '$' + Math.round(lead.avgPrice).toLocaleString() : '—';

    if (statusEl && typeof getStatusBadge === 'function') {
      statusEl.innerHTML = getStatusBadge(lead.status || 'new');
    } else if (statusEl) {
      statusEl.textContent = lead.status || 'new';
    }

    if (dateEl) {
      dateEl.textContent = fmtTime(lead.time || (lead.receivedAt || null));
    }

    // POLARIS Insight
    if (polarisEl) {
      polarisEl.textContent = generatePolarisInsight(lead);
    }

    // Pricing Breakdown
    if (pbEl) {
      if (lead.pricingBreakdown && Array.isArray(lead.pricingBreakdown) && lead.pricingBreakdown.length > 0) {
        var pbHtml = '';
        var pbTotal = 0;
        lead.pricingBreakdown.forEach(function(item) {
          pbTotal += item.a || 0;
          pbHtml += '<div class="drawer-pricing-item"><span>' + item.l + '</span><span>$' + Math.round(item.a || 0).toLocaleString() + '</span></div>';
        });
        pbHtml += '<div class="drawer-pricing-item"><span><strong>Total</strong></span><span><strong>$' + Math.round(pbTotal).toLocaleString() + '</strong></span></div>';
        pbEl.innerHTML = pbHtml;
      } else {
        pbEl.innerHTML = '<p style="font-size:13px;color:var(--neutral-500);">Est. value: $' + Math.round(lead.avgPrice || 0).toLocaleString() + '</p>';
      }
    }

    // Transcript
    if (transcriptEl) {
      transcriptEl.innerHTML = formatTranscript(lead.transcript, lead.caller);
      transcriptEl.scrollTop = 0;
    }

    // Show drawer
    if (overlayEl) overlayEl.classList.add('open');
    if (drawerEl) drawerEl.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Close the customer drawer.
   */
  function close() {
    var overlayEl = safeGet('drawerOverlay');
    var drawerEl = safeGet('customerDrawer');
    if (overlayEl) overlayEl.classList.remove('open');
    if (drawerEl) drawerEl.classList.remove('open');
    document.body.style.overflow = '';
    currentLead = null;
  }

  /**
   * Get the currently displayed lead (read-only).
   */
  function getCurrent() {
    return currentLead;
  }

  // Register Escape key to close
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') close();
  });

  return {
    open: open,
    close: close,
    getCurrent: getCurrent
  };
})();
