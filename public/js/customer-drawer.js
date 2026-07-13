/**
 * CustomerDrawer — Shared Customer Record Drawer
 * The single customer detail view for the entire NorthStar platform.
 * Leads, Communications, and Dashboard all use this same component.
 *
 * Usage:
 *   CustomerDrawer.open(lead)  — populate and open the drawer
 *   CustomerDrawer.close()     — close the drawer
 *
 * Requires: drawer HTML template (drawer-overlay + customer-drawer) in the page,
 *           PolarisEngine, and the shared .tooltip and .drawer-* CSS from style.css.
 */
window.CustomerDrawer = (function() {
  var currentLead = null;

  function capitalizeFirst(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function fmtTime(dateVal) {
    if (!dateVal) return '—';
    try {
      var d = new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch(e) { return String(dateVal); }
  }

  function getStatusBadge(status) {
    var cls = 'badge-new';
    var label = 'New';
    if (status === 'contacted' || status === 'follow-up') { cls = 'badge-contacted'; label = 'Follow-up'; }
    else if (status === 'scheduled') { cls = 'badge-scheduled'; label = 'Appointment Set'; }
    else if (status === 'completed') { cls = 'badge-completed'; label = 'Completed'; }
    else if (status === 'won') { cls = 'badge-won'; label = 'Won'; }
    else if (status === 'lost') { cls = 'badge-lost'; label = 'Lost'; }
    else if (status === 'voicemail') { cls = 'badge-voicemail'; label = 'Voicemail'; }
    return '<span class="badge ' + cls + '">' + label + '</span>';
  }

  function generatePolarisInsight(lead) {
    if (typeof PolarisEngine !== 'undefined' && PolarisEngine.analyzeLead) {
      var result = PolarisEngine.analyzeLead(lead);
      return result.insight || result;
    }
    return 'No Polaris insight available.';
  }

  function formatTranscript(transcript, callerName) {
    if (!transcript) return 'No transcript available.';
    try {
      return transcript.split('\n').map(function(l) {
        if (l.startsWith('AI:')) {
          return '<div class="transcript-line transcript-ai"><span class="transcript-speaker">AI</span> ' + l.substring(3) + '</div>';
        }
        if (l.startsWith('Customer:')) {
          var first = callerName ? callerName.split(' ')[0] : 'Customer';
          return '<div class="transcript-line transcript-customer"><span class="transcript-speaker">' + first + '</span> ' + l.substring(9) + '</div>';
        }
        return '<div class="transcript-line">' + l + '</div>';
      }).join('');
    } catch(e) { return transcript; }
  }

  function open(lead) {
    if (!lead) return;
    currentLead = lead;

    var el = function(id) { return document.getElementById(id); };

    el('drawerTitle').textContent = lead.caller || lead.customerName || 'Customer Details';

    // Contact Information
    el('drawerName').textContent = lead.caller || lead.customerName || '—';
    el('drawerPhone').textContent = lead.phone || lead.phoneNumber || '—';
    el('drawerAddress').textContent = lead.address || '—';

    // Job Details
    el('drawerService').textContent = lead.service || lead.serviceRequested || '—';
    var desc = lead.jobDetail || lead.summary || '';
    el('drawerDescription').textContent = desc ? capitalizeFirst(desc) : '—';
    el('drawerValue').textContent = lead.avgPrice ? '$' + Math.round(lead.avgPrice).toLocaleString() : '—';
    el('drawerStatus').innerHTML = getStatusBadge(lead.status || 'new');
    el('drawerDate').textContent = fmtTime(lead.time || (lead.receivedAt ? lead.receivedAt : null));

    // POLARIS Revenue Intelligence
    var polarisEl = el('drawerPolarisInsight');
    var analysis = lead.polarisAnalysis;
    if (!analysis && typeof PolarisEngine !== 'undefined' && PolarisEngine.analyzeLead) {
      analysis = PolarisEngine.analyzeLead(lead);
    }
    if (analysis && analysis.insight) {
      var confLabel = analysis.confidence >= 80 ? 'High' : analysis.confidence >= 50 ? 'Medium' : 'Low';
      var confClass = confLabel.toLowerCase();
      var price = Math.round(analysis.estimatedPrice || 0).toLocaleString();
      polarisEl.innerHTML = '<div class="drawer-polaris-grid">' +
        '<div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Summary</div><div class="drawer-polaris-item-value">' + analysis.insight + '</div></div>' +
        '<div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Pricing Recommendation</div><div class="drawer-polaris-item-value">$' + price + '</div></div>' +
        '<div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Confidence Score</div><div class="drawer-polaris-item-value"><span class="polaris-confidence ' + confClass + '">' + confLabel + ' (' + analysis.confidence + '%)</span></div></div>' +
        '<div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Revenue Opportunity</div><div class="drawer-polaris-item-value">$' + price + ' \u2014 ' + (analysis.service || 'Service') + '</div></div>' +
        '<div class="drawer-polaris-item"><div class="drawer-polaris-item-label">Recommendation</div><div class="drawer-polaris-item-value">' + (analysis.upsell || 'Standard service') + '</div></div>' +
        '</div>';
    } else {
      polarisEl.innerHTML = '<p style="font-size:13px;color:var(--neutral-500);">' + generatePolarisInsight(lead) + '</p>';
    }

    // Pricing Breakdown
    var pbDiv = el('drawerPricingBreakdown');
    if (lead.pricingBreakdown && Array.isArray(lead.pricingBreakdown) && lead.pricingBreakdown.length > 0) {
      var pbHtml = '';
      var pbTotal = 0;
      lead.pricingBreakdown.forEach(function(item) {
        pbTotal += item.a || 0;
        pbHtml += '<div class="drawer-pricing-item"><span>' + (item.l || 'Item') + '</span><span>$' + Math.round(item.a || 0).toLocaleString() + '</span></div>';
      });
      pbHtml += '<div class="drawer-pricing-item"><span><strong>Total</strong></span><span><strong>$' + Math.round(pbTotal).toLocaleString() + '</strong></span></div>';
      pbDiv.innerHTML = pbHtml;
    } else {
      pbDiv.innerHTML = '<p style="font-size:13px;color:var(--neutral-500);">Est. value: $' + Math.round(lead.avgPrice || 0).toLocaleString() + '</p>';
    }

    // Call Transcript
    var transcriptEl = el('drawerTranscript');
    transcriptEl.innerHTML = formatTranscript(lead.transcript, lead.caller || lead.customerName);
    transcriptEl.scrollTop = 0;

    // Open the drawer
    el('drawerOverlay').classList.add('open');
    el('customerDrawer').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    var overlay = document.getElementById('drawerOverlay');
    var drawer = document.getElementById('customerDrawer');
    if (overlay) overlay.classList.remove('open');
    if (drawer) drawer.classList.remove('open');
    document.body.style.overflow = '';
    currentLead = null;
  }

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') close();
  });

  return {
    open: open,
    close: close
  };
})();