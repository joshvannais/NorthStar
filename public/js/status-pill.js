/**
 * StatusPill — Shared Status Pill Renderer
 * Single source of truth for status pill rendering across all pages.
 *
 * Usage:
 *   StatusPill.render(status)  → '<span class="call-status-badge booked">Booked</span>'
 *
 * The call-status-badge CSS classes are defined in style.css.
 * For the drawer context, use StatusPill.renderDrawer(status) which uses badge-* classes.
 */
window.StatusPill = (function() {
  // Status → CSS class mapping (call-status-badge system)
  var classMap = {
    'new': 'answered',
    'scheduled': 'booked',
    'booked': 'booked',
    'contacted': 'estimate',
    'follow-up': 'followup',
    'completed': 'completed',
    'won': 'won',
    'lost': 'lost',
    'voicemail': 'voicemail',
    'no-interest': 'nointerest',
    'answered': 'answered',
    'missed': 'missed',
    'demo': 'demo'
  };

  // Status → label mapping (standardized across all pages)
  var labelMap = {
    'new': 'New',
    'scheduled': 'Booked',
    'booked': 'Booked',
    'contacted': 'Follow-up',
    'follow-up': 'Follow Up',
    'completed': 'Completed',
    'won': 'Won',
    'lost': 'Lost',
    'voicemail': 'Voicemail',
    'no-interest': 'No Interest',
    'answered': 'Answered',
    'missed': 'Missed',
    'demo': 'Demo'
  };

  // Outcome → class mapping (for Communications page call outcomes)
  var outcomeClassMap = {
    'appointment-set': 'booked',
    'lead-captured': 'estimate',
    'follow-up': 'followup',
    'no-interest': 'nointerest',
    'voicemail': 'voicemail',
    'answered': 'answered'
  };

  // Outcome → label mapping
  var outcomeLabelMap = {
    'appointment-set': 'Booked',
    'lead-captured': 'Estimate',
    'follow-up': 'Follow Up',
    'no-interest': 'No Interest',
    'voicemail': 'Voicemail',
    'answered': 'Answered'
  };

  // Status → CSS class mapping (badge system for drawer)
  var drawerClassMap = {
    'new': 'badge-new',
    'contacted': 'badge-contacted',
    'follow-up': 'badge-contacted',
    'scheduled': 'badge-scheduled',
    'completed': 'badge-completed',
    'won': 'badge-won',
    'lost': 'badge-lost',
    'voicemail': 'badge-voicemail'
  };

  // Status → label mapping (drawer labels)
  var drawerLabelMap = {
    'new': 'New',
    'contacted': 'Follow-up',
    'follow-up': 'Follow-up',
    'scheduled': 'Appointment Set',
    'completed': 'Completed',
    'won': 'Won',
    'lost': 'Lost',
    'voicemail': 'Voicemail'
  };

  /**
   * Render a status pill using the call-status-badge class system.
   * Used in Dashboard, Communications, and All Leads list views.
   * @param {string} status - The lead/call status or outcome value
   * @param {Object} [options] - Optional rendering options
   * @param {string} [options.type='status'] - 'status' or 'outcome' for Communications page
   * @param {string} [options.leadStatus] - The lead's raw status (for Communications voicemail override)
   * @returns {string} HTML string for the status pill span
   */
  function render(status, options) {
    status = status || 'new';
    options = options || {};
    var type = options.type || 'status';

    // Communications page: use leadStatus for voicemail override
    if (type === 'outcome' && options.leadStatus === 'voicemail') {
      return '<span class="call-status-badge voicemail">Voicemail</span>';
    }

    var cls, label;
    if (type === 'outcome') {
      cls = outcomeClassMap[status.toLowerCase()] || 'answered';
      label = outcomeLabelMap[status.toLowerCase()] || status.charAt(0).toUpperCase() + status.slice(1).replace(/-/g, ' ');
    } else {
      cls = classMap[status.toLowerCase()] || 'answered';
      label = labelMap[status.toLowerCase()] || status.charAt(0).toUpperCase() + status.slice(1);
    }
    return '<span class="call-status-badge ' + cls + '">' + label + '</span>';
  }

  /**
   * Render a status pill using the badge class system (for Customer Drawer).
   * Uses the drawer's specific label and CSS class conventions.
   * @param {string} status - The lead/call status value
   * @returns {string} HTML string for the drawer status pill span
   */
  function renderDrawer(status) {
    status = status || 'new';
    var cls = drawerClassMap[status.toLowerCase()] || 'badge-new';
    var label = drawerLabelMap[status.toLowerCase()] || 'New';
    return '<span class="badge ' + cls + '">' + label + '</span>';
  }

  /**
   * Get the CSS class for a status (call-status-badge system).
   * Useful when building custom HTML that includes a status pill.
   */
  function getClass(status) {
    status = status || 'new';
    return classMap[status.toLowerCase()] || 'answered';
  }

  /**
   * Get the human-readable label for a status.
   * Useful when building custom HTML that includes a status pill.
   */
  function getLabel(status) {
    status = status || 'new';
    return labelMap[status.toLowerCase()] || status.charAt(0).toUpperCase() + status.slice(1);
  }

  return {
    render: render,
    renderDrawer: renderDrawer,
    getClass: getClass,
    getLabel: getLabel
  };
})();