/**
 * PolarisUI — Polaris Intelligence Experience Platform
 * Mission 14: Polaris Experience 2.0
 *
 * Context-agnostic rendering engine. Every component is individually
 * usable by any page (Lead, Customer, Job, Dashboard, Communications).
 *
 * Dependencies: none. All styles are self-contained.
 * Shared file modifications: zero.
 */
(function() {
  'use strict';

  /* ─── Helpers ─────────────────────────────────────────── */

  var H = {};

  H.esc = function(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  H.fmtCurrency = function(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  H.fmtPct = function(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(n) + '%';
  };

  H.fmtDate = function(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      var now = new Date();
      var diffSec = Math.floor((now - d) / 1000);
      if (diffSec < 60) return 'just now';
      if (diffSec < 3600) return Math.floor(diffSec / 60) + 'm ago';
      if (diffSec < 86400) return Math.floor(diffSec / 3600) + 'h ago';
      return d.toLocaleDateString();
    } catch(e) { return ''; }
  };

  H.severityColor = function(sev) {
    if (sev === 'critical' || sev === 'at-risk') return { text: '#991b1b', bg: '#fee2e2', dot: '#dc2626' };
    if (sev === 'warning' || sev === 'attention') return { text: '#92400e', bg: '#fef3c7', dot: '#d97706' };
    return { text: '#166534', bg: '#dcfce7', dot: '#16a34a' };
  };

  H.confidenceClass = function(score) {
    if (score >= 80) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  };

  H.progressBar = function(pct) {
    if (pct == null) return '';
    var clamped = Math.min(100, Math.max(0, pct));
    return '<div class="polaris-progress-track"><div class="polaris-progress-fill" style="width:' + clamped + '%;"></div></div>';
  };

  H.badge = function(text, opts) {
    opts = opts || {};
    var style = opts.style || 'default';
    var colors = { default: '#6b7280', green: '#166534', amber: '#92400e', red: '#991b1b', gold: '#a67c00' };
    var bgColors = { default: '#f3f4f6', green: '#dcfce7', amber: '#fef3c7', red: '#fee2e2', gold: '#fef9c3' };
    var bg = bgColors[style] || bgColors.default;
    var color = colors[style] || colors.default;
    return '<span class="polaris-badge" style="background:' + bg + ';color:' + color + ';">' + H.esc(text) + '</span>';
  };

  H.skeleton = function(width, height, opts) {
    opts = opts || {};
    var w = width || '100%';
    var h = height || '16px';
    var mb = opts.mb || '0';
    var br = opts.br || '4px';
    return '<div class="polaris-skeleton" style="width:' + w + ';height:' + h + ';margin-bottom:' + mb + ';border-radius:' + br + ';"></div>';
  };

  H.isEmpty = function(val) {
    if (val == null) return true;
    if (Array.isArray(val)) return val.length === 0;
    if (typeof val === 'object') return Object.keys(val).length === 0;
    return val === '' || val === '—';
  };

  H.emptyState = function(message, hint) {
    return '<div class="polaris-empty">' +
      '<div class="polaris-empty-icon">📋</div>' +
      '<div class="polaris-empty-text">' + H.esc(message) + '</div>' +
      (hint ? '<div class="polaris-empty-hint">' + H.esc(hint) + '</div>' : '') +
    '</div>';
  };

  /* ─── Inline Styles ───────────────────────────────────── */

  var CSS = (function() {
    var s = '';

    // Base card
    s += '.polaris-card{background:var(--neutral-50,#fff);border:1px solid var(--neutral-200,#e5e7eb);border-radius:8px;padding:20px;margin-bottom:12px;}';
    s += '.polaris-card:last-child{margin-bottom:0;}';

    // Header
    s += '.polaris-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--neutral-200,#e5e7eb);}';
    s += '.polaris-header-title{font-size:16px;font-weight:700;color:var(--neutral-900,#111827);display:flex;align-items:center;gap:8px;}';
    s += '.polaris-header-meta{font-size:12px;color:var(--neutral-500,#6b7280);}';
    s += '.polaris-live-badge{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:#fef3c7;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;}';

    // Status bar
    s += '.polaris-statusbar{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;}';
    s += '.polaris-status-item{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--neutral-700,#374151);padding:6px 12px;background:var(--neutral-100,#f3f4f6);border-radius:6px;}';
    s += '.polaris-status-dot{width:8px;height:8px;border-radius:50%;display:inline-block;}';

    // Section heading
    s += '.polaris-section-heading{font-size:13px;font-weight:600;color:var(--neutral-500,#6b7280);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;}';

    // Metric grid
    s += '.polaris-metric-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:16px;}';
    s += '.polaris-metric-label{font-size:11px;font-weight:600;color:var(--neutral-500,#6b7280);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;}';
    s += '.polaris-metric-value{font-size:20px;font-weight:700;color:var(--neutral-900,#111827);line-height:1.2;}';
    s += '.polaris-metric-sub{font-size:12px;color:var(--neutral-500,#6b7280);margin-top:2px;}';
    s += '.polaris-metric-value.gold{color:#a67c00;}';
    s += '.polaris-metric-value.green{color:#166534;}';
    s += '.polaris-metric-value.red{color:#991b1b;}';

    // Explain link
    s += '.polaris-explain{font-size:12px;color:var(--brand-600,#a67c00);cursor:pointer;margin-top:6px;display:inline-block;}';
    s += '.polaris-explain:hover{text-decoration:underline;}';
    s += '.polaris-explain-panel{margin-top:8px;padding:12px;background:var(--neutral-100,#f3f4f6);border-radius:6px;font-size:13px;color:var(--neutral-700,#374151);line-height:1.6;display:none;}';
    s += '.polaris-explain-panel.open{display:block;}';

    // Estimate items
    s += '.polaris-estimate-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--neutral-100,#f3f4f6);font-size:13px;}';
    s += '.polaris-estimate-row:last-of-type{border-bottom:none;}';
    s += '.polaris-estimate-label{color:var(--neutral-700,#374151);}';
    s += '.polaris-estimate-desc{font-size:11px;color:var(--neutral-500,#6b7280);}';
    s += '.polaris-estimate-amount{font-weight:500;white-space:nowrap;}';
    s += '.polaris-estimate-total-row{display:flex;justify-content:space-between;padding:8px 0;margin-top:4px;border-top:2px solid var(--neutral-300,#d1d5db);font-size:16px;font-weight:700;}';
    s += '.polaris-estimate-total-amount{color:var(--brand-600,#a67c00);}';
    s += '.polaris-estimate-subtotal-row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:var(--neutral-500,#6b7280);}';
    s += '.polaris-upsell-row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px;}';

    // Progress bar
    s += '.polaris-progress-track{height:4px;background:var(--neutral-100,#f3f4f6);border-radius:2px;overflow:hidden;margin-top:4px;}';
    s += '.polaris-progress-fill{height:100%;background:var(--brand-500,#a67c00);border-radius:2px;transition:width 0.3s ease;}';

    // Skeleton
    s += '.polaris-skeleton{background:linear-gradient(90deg,var(--neutral-100,#f3f4f6) 25%,var(--neutral-50,#fafafa) 50%,var(--neutral-100,#f3f4f6) 75%);background-size:200% 100%;animation:polaris-shimmer 1.5s infinite;}';
    s += '@keyframes polaris-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}';

    // Empty state
    s += '.polaris-empty{padding:16px;text-align:center;color:var(--neutral-400,#9ca3af);}';
    s += '.polaris-empty-icon{font-size:24px;margin-bottom:8px;}';
    s += '.polaris-empty-text{font-size:13px;font-weight:500;margin-bottom:4px;}';
    s += '.polaris-empty-hint{font-size:12px;color:var(--neutral-400,#9ca3af);}';

    // Badge
    s += '.polaris-badge{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;white-space:nowrap;}';

    // Risk items
    s += '.polaris-risk-item{display:flex;gap:8px;align-items:flex-start;padding:6px 0;font-size:13px;}';
    s += '.polaris-risk-item:not(:last-child){border-bottom:1px solid var(--neutral-100,#f3f4f6);}';

    // Action items
    s += '.polaris-action-item{display:flex;gap:8px;align-items:flex-start;padding:6px 0;font-size:13px;}';
    s += '.polaris-action-item:not(:last-child){border-bottom:1px solid var(--neutral-100,#f3f4f6);}';
    s += '.polaris-action-bullet{color:var(--brand-600,#a67c00);font-weight:700;}';

    // Confidence badge
    s += '.polaris-conf-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;}';
    s += '.polaris-conf-badge.high{background:#dcfce7;color:#166534;}';
    s += '.polaris-conf-badge.medium{background:#fef3c7;color:#92400e;}';
    s += '.polaris-conf-badge.low{background:#fee2e2;color:#991b1b;}';

    // Loading overlay
    s += '.polaris-loading{opacity:0.6;pointer-events:none;}';

    // Transition
    s += '.polaris-fade-in{animation:polaris-fade 0.3s ease-out;}';
    s += '@keyframes polaris-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}';

    // Dark theme overrides
    s += '[data-theme="dark"] .polaris-card{background:var(--neutral-800,#1f2937);border-color:var(--neutral-700,#374151);}';
    s += '[data-theme="dark"] .polaris-header-title{color:var(--neutral-200,#e5e7eb);}';
    s += '[data-theme="dark"] .polaris-header-meta{color:var(--neutral-400,#9ca3af);}';
    s += '[data-theme="dark"] .polaris-metric-value{color:var(--neutral-200,#e5e7eb);}';
    s += '[data-theme="dark"] .polaris-metric-label{color:var(--neutral-400,#9ca3af);}';
    s += '[data-theme="dark"] .polaris-section-heading{color:var(--neutral-400,#9ca3af);}';
    s += '[data-theme="dark"] .polaris-status-item{background:var(--neutral-800,#1f2937);color:var(--neutral-300,#d1d5db);}';
    s += '[data-theme="dark"] .polaris-estimate-row{border-color:var(--neutral-700,#374151);}';
    s += '[data-theme="dark"] .polaris-estimate-label{color:var(--neutral-300,#d1d5db);}';
    s += '[data-theme="dark"] .polaris-estimate-desc{color:var(--neutral-500,#6b7280);}';
    s += '[data-theme="dark"] .polaris-estimate-total-row{border-color:var(--neutral-600,#4b5563);}';
    s += '[data-theme="dark"] .polaris-explain-panel{background:var(--neutral-800,#1f2937);color:var(--neutral-300,#d1d5db);}';
    s += '[data-theme="dark"] .polaris-risk-item{border-color:var(--neutral-700,#374151);}';
    s += '[data-theme="dark"] .polaris-action-item{border-color:var(--neutral-700,#374151);}';
    s += '[data-theme="dark"] .polaris-progress-track{background:var(--neutral-700,#374151);}';
    s += '[data-theme="dark"] .polaris-skeleton{background:linear-gradient(90deg,var(--neutral-800,#1f2937) 25%,var(--neutral-700,#374151) 50%,var(--neutral-800,#1f2937) 75%);background-size:200% 100%;}';
    s += '[data-theme="dark"] .polaris-empty{color:var(--neutral-500,#6b7280);}';
    s += '[data-theme="dark"] .polaris-empty-hint{color:var(--neutral-500,#6b7280);}';
    s += '[data-theme="dark"] .polaris-live-badge{background:rgba(212,175,55,0.2);color:var(--brand-400,#d4af37);}';

    // Responsive
    s += '@media(max-width:640px){.polaris-metric-grid{grid-template-columns:repeat(2,1fr);gap:12px;}.polaris-statusbar{gap:8px;}.polaris-header{flex-direction:column;align-items:flex-start;gap:4px;}}';

    return '<style>' + s + '</style>';
  })();

  /* ─── Components ──────────────────────────────────────── */

  var C = {};

  C.Header = function(data, opts) {
    opts = opts || {};
    var generatedAt = (data && data.generatedAt) ? H.fmtDate(data.generatedAt) : '';
    var context = opts.context || '';
    var subtitle = 'AI-powered estimate';
    if (context === 'customer') subtitle = 'Customer intelligence report';
    else if (context === 'job') subtitle = 'Job intelligence report';

    return '<div class="polaris-header polaris-fade-in">' +
      '<div class="polaris-header-title">' +
        '🏆 POLARIS™ Intelligence Report' +
        '<span class="polaris-live-badge">LIVE</span>' +
      '</div>' +
      '<div class="polaris-header-meta">' +
        (generatedAt ? 'Generated ' + generatedAt : subtitle) +
      '</div>' +
    '</div>';
  };

  C.StatusBar = function(data, opts) {
    if (!data) return '';
    opts = opts || {};
    var es = data.executiveSummary || {};
    var overview = es.overview || {};
    var health = overview.health || 'stable';
    var riskCount = overview.riskCount || (es.risks ? es.risks.length : 0);
    var recCount = overview.recommendationCount || (es.recommendations ? es.recommendations.length : 0);
    var colors = H.severityColor(health);

    return '<div class="polaris-statusbar">' +
      '<div class="polaris-status-item">' +
        '<span class="polaris-status-dot" style="background:' + colors.dot + ';"></span>' +
        '<span style="font-weight:500;color:' + colors.text + ';">' +
          (health === 'stable' ? 'Stable' : health === 'at-risk' ? 'At Risk' : health.charAt(0).toUpperCase() + health.slice(1)) +
        '</span>' +
      '</div>' +
      (riskCount > 0 ? '<div class="polaris-status-item"><span style="color:#991b1b;">⚠</span> ' + riskCount + ' risk' + (riskCount !== 1 ? 's' : '') + '</div>' : '') +
      (recCount > 0 ? '<div class="polaris-status-item"><span style="color:#166534;">✓</span> ' + recCount + ' recommendation' + (recCount !== 1 ? 's' : '') + '</div>' : '') +
    '</div>';
  };

  C.RevenueSection = function(data, opts) {
    if (!data) return '';
    var confidence = data.confidence;
    var confLabel = data.confidenceLabel || (confidence != null ? H.confidenceClass(confidence) : '');
    var confDesc = data.confidenceDescription || '';
    var difficulty = data.difficulty || data.difficultyLabel || '';
    var profitMargin = data.profitMargin;
    var region = data.region || '';

    return '<div class="polaris-card polaris-fade-in">' +
      '<div class="polaris-section-heading">Revenue Intelligence</div>' +
      '<div class="polaris-metric-grid">' +
        (data.total ? '<div><div class="polaris-metric-label">Est. Price</div><div class="polaris-metric-value gold">' + H.fmtCurrency(data.total) + '</div>' +
          (region ? '<div class="polaris-metric-sub">' + H.esc(region) + '</div>' : '') +
        '</div>' : '') +
        (confidence != null ? '<div><div class="polaris-metric-label">Confidence</div>' +
          '<span class="polaris-conf-badge ' + H.confidenceClass(confidence) + '">' + Math.round(confidence) + '% ' + confLabel + '</span>' +
          (confDesc ? '<div class="polaris-metric-sub" style="margin-top:4px;">' + H.esc(confDesc) + '</div>' : '') +
        '</div>' : '') +
        (difficulty ? '<div><div class="polaris-metric-label">Difficulty</div><div class="polaris-metric-value" style="font-size:16px;text-transform:capitalize;">' + H.esc(difficulty) + '</div></div>' : '') +
        (profitMargin != null ? '<div><div class="polaris-metric-label">Profit Margin</div><div class="polaris-metric-value ' + (profitMargin > 15 ? 'green' : 'red') + '" style="font-size:16px;">' + H.fmtPct(profitMargin) + '</div></div>' : '') +
      '</div>' +
      (confDesc ? C._explainPanel('why-confidence', 'Why ' + Math.round(confidence) + '%?', confDesc) : '') +
    '</div>';
  };

  C._explainPanel = function(id, label, content) {
    return '<div class="polaris-explain" onclick="var p=document.getElementById(\'' + id + '\');p.className=p.className===\'polaris-explain-panel open\'?\'polaris-explain-panel\':\'polaris-explain-panel open\';">' + H.esc(label) + ' <span style="font-size:10px;">▾</span></div>' +
      '<div id="' + id + '" class="polaris-explain-panel">' + content + '</div>';
  };

  C.EstimateSection = function(data, opts) {
    if (!data || !data.items || data.items.length === 0) return '';

    var items = data.items;
    var upsells = data.upsells || [];
    var service = data.service || 'Estimate';
    var difficultyLabel = data.difficultyLabel || '';
    var confidence = data.confidence;
    var confLabel = data.confidenceLabel || '';

    var rows = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var typeLabel = item.label || (item.type ? item.type.charAt(0).toUpperCase() + item.type.slice(1) : '');
      rows += '<div class="polaris-estimate-row">' +
        '<div><div class="polaris-estimate-label">' + H.esc(typeLabel) + '</div>' +
        (item.description ? '<div class="polaris-estimate-desc">' + H.esc(item.description) + '</div>' : '') +
        '</div>' +
        '<div class="polaris-estimate-amount">' + H.fmtCurrency(item.amount) + '</div>' +
      '</div>';
    }

    // Subtotal row
    var subtotal = data.subtotal;
    if (subtotal == null) {
      subtotal = 0;
      for (var j = 0; j < items.length; j++) { subtotal += items[j].amount || 0; }
    }

    var overhead = data.overhead;
    var profit = data.profitMargin != null ? (subtotal * (data.profitMargin / 100)) : null;

    var upsellRows = '';
    if (upsells.length > 0) {
      upsellRows = '<div style="margin-top:12px;padding-top:8px;border-top:2px solid #fef3c7;">' +
        '<div style="font-size:12px;font-weight:600;color:#a67c00;margin-bottom:6px;">Recommended Add-ons</div>';
      for (var k = 0; k < upsells.length; k++) {
        var u = upsells[k];
        upsellRows += '<div class="polaris-upsell-row">' +
          '<div><span>' + H.esc(u.label) + '</span><div style="font-size:11px;color:var(--neutral-500);">' + H.esc(u.description || '') + '</div></div>' +
          '<span style="font-weight:500;">' + H.fmtCurrency(u.amount) + '</span></div>';
      }
      upsellRows += '</div>';
    }

    var total = data.total;
    if (total == null) {
      total = subtotal;
      if (data.taxes != null) total += data.taxes;
    }

    return '<div class="polaris-card polaris-fade-in">' +
      '<div class="polaris-section-heading">Line-Item Estimate</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
        '<div style="font-size:13px;font-weight:500;">' + H.esc(service) + '</div>' +
        (confLabel ? '<span class="polaris-conf-badge ' + H.confidenceClass(confidence) + '" style="font-size:11px;">' + H.esc(confLabel) + ' ' + Math.round(confidence) + '%</span>' : '') +
      '</div>' +
      rows +
      '<div class="polaris-estimate-total-row">' +
        '<span>Total</span>' +
        '<span class="polaris-estimate-total-amount">' + H.fmtCurrency(total) + '</span>' +
      '</div>' +
      upsellRows +
      (data.reasoning ? '<div style="margin-top:10px;padding:8px;background:var(--neutral-50,#fafafa);border-radius:4px;font-size:11px;color:var(--neutral-600,#6b7280);line-height:1.5;">' +
        '<strong>AI Reasoning:</strong> ' + H.esc(data.reasoning) +
      '</div>' : '') +
    '</div>';
  };

  C.CustomerSection = function(data, opts) {
    var ci = data ? data.customerIntelligence : null;
    if (!ci) {
      return '<div class="polaris-card">' +
        '<div class="polaris-section-heading">Customer Intelligence</div>' +
        H.emptyState('No customer data available.', 'Customer insights will appear once this lead is associated with a customer profile.') +
      '</div>';
    }

    var healthColors = H.severityColor(ci.riskLevel === 'high' ? 'at-risk' : ci.riskLevel === 'medium' ? 'warning' : 'stable');

    return '<div class="polaris-card polaris-fade-in">' +
      '<div class="polaris-section-heading">Customer Intelligence</div>' +
      '<div class="polaris-metric-grid">' +
        (ci.healthScore != null ? '<div><div class="polaris-metric-label">Health</div><div class="polaris-metric-value" style="font-size:16px;color:' + healthColors.text + ';">' + ci.healthScore + '/100</div></div>' : '') +
        (ci.lifecycleStage ? '<div><div class="polaris-metric-label">Lifecycle</div><div class="polaris-metric-value" style="font-size:16px;text-transform:capitalize;">' + H.esc(ci.lifecycleStage) + '</div></div>' : '') +
        (ci.retentionScore != null ? '<div><div class="polaris-metric-label">Retention</div><div class="polaris-metric-value" style="font-size:16px;">' + ci.retentionScore + '%</div></div>' : '') +
        (ci.totalJobs != null ? '<div><div class="polaris-metric-label">Total Jobs</div><div class="polaris-metric-value" style="font-size:16px;">' + ci.totalJobs + '</div></div>' : '') +
        (ci.lifetimeValue != null ? '<div><div class="polaris-metric-label">Lifetime Value</div><div class="polaris-metric-value gold" style="font-size:16px;">' + H.fmtCurrency(ci.lifetimeValue) + '</div></div>' : '') +
        (ci.averageInvoice != null ? '<div><div class="polaris-metric-label">Avg Invoice</div><div class="polaris-metric-value" style="font-size:16px;">' + H.fmtCurrency(ci.averageInvoice) + '</div></div>' : '') +
        (ci.segment ? '<div><div class="polaris-metric-label">Segment</div><div class="polaris-metric-value" style="font-size:16px;text-transform:capitalize;">' + H.esc(ci.segment) + '</div></div>' : '') +
        (ci.riskLevel ? '<div><div class="polaris-metric-label">Risk</div><div class="polaris-metric-value" style="font-size:16px;text-transform:capitalize;color:' + healthColors.text + ';">' + H.esc(ci.riskLevel) + '</div></div>' : '') +
      '</div>' +
    '</div>';
  };

  C.OperationsSection = function(data, opts) {
    var ji = data ? data.jobIntelligence : null;
    var cr = data ? data.crewIntelligence : null;
    var wf = data ? data.workflowIntelligence : null;
    var ast = data ? data.assetsIntelligence : null;

    if (!ji && !cr && !wf && !ast) {
      return '<div class="polaris-card">' +
        '<div class="polaris-section-heading">Operations</div>' +
        H.emptyState('No operational data.', 'Operational insights will appear once work begins.') +
      '</div>';
    }

    var hasJob = ji && ji.status;
    var hasCrew = cr && cr.name;
    var hasWF = wf && wf.totalTasks != null;
    var hasAssets = ast && ast.length > 0;

    return '<div class="polaris-card polaris-fade-in">' +
      '<div class="polaris-section-heading">Operations</div>' +
      '<div class="polaris-metric-grid">' +
        (hasJob ? '<div><div class="polaris-metric-label">Job Status</div><div class="polaris-metric-value" style="font-size:14px;text-transform:capitalize;">' + H.esc(ji.status) + '</div>' +
          (ji.progress != null ? H.progressBar(ji.progress) + '<div class="polaris-metric-sub">' + Math.round(ji.progress) + '% complete</div>' : '') +
        '</div>' : '') +
        (hasCrew ? '<div><div class="polaris-metric-label">Crew</div><div class="polaris-metric-value" style="font-size:14px;">' + H.esc(cr.name) + '</div>' +
          (cr.memberCount ? '<div class="polaris-metric-sub">' + cr.memberCount + ' members' + (cr.efficiency ? ' · ' + cr.efficiency + '% efficiency' : '') + '</div>' : '') +
        '</div>' : '') +
        (hasWF ? '<div><div class="polaris-metric-label">Workflow</div>' +
          '<div style="font-size:13px;color:var(--neutral-700);">' + wf.completedTasks + '/' + wf.totalTasks + ' tasks</div>' +
          (wf.completionRate != null ? '<div class="polaris-metric-sub">' + wf.completionRate + '% complete' +
            (wf.overdueTasks > 0 ? ' · <span style="color:#991b1b;">' + wf.overdueTasks + ' overdue</span>' : '') +
          '</div>' : '') +
        '</div>' : '') +
        (hasAssets ? '<div><div class="polaris-metric-label">Assets</div><div class="polaris-metric-value" style="font-size:14px;">' + ast.length + ' active</div></div>' : '') +
      '</div>' +
    '</div>';
  };

  C.RisksSection = function(data, opts) {
    var risks = (data && data.executiveSummary && data.executiveSummary.risks) || [];
    if (!risks || risks.length === 0) {
      return '<div class="polaris-card">' +
        '<div class="polaris-section-heading">Risks</div>' +
        '<div style="font-size:13px;color:var(--neutral-500,#6b7280);">No risks detected. <span style="color:#166534;">✓</span></div>' +
      '</div>';
    }

    var html = '<div class="polaris-card polaris-fade-in">' +
      '<div class="polaris-section-heading">Risks</div>';
    for (var i = 0; i < risks.length; i++) {
      var r = risks[i];
      var colors = H.severityColor(r.severity || 'warning');
      html += '<div class="polaris-risk-item">' +
        '<span style="font-size:14px;flex-shrink:0;">' + (r.severity === 'critical' ? '🚨' : '⚠️') + '</span>' +
        '<div><span style="font-weight:500;color:' + colors.text + ';">' + H.esc(r.message || r.risk || '') + '</span></div>' +
      '</div>';
    }
    return html + '</div>';
  };

  C.ActionsSection = function(data, opts) {
    var recs = [];
    if (data && data.executiveSummary && data.executiveSummary.recommendations) {
      recs = data.executiveSummary.recommendations;
    }
    if (!recs || recs.length === 0) {
      return '<div class="polaris-card">' +
        '<div class="polaris-section-heading">Recommended Actions</div>' +
        '<div style="font-size:13px;color:var(--neutral-500,#6b7280);">All systems operational. No recommended actions at this time.</div>' +
      '</div>';
    }

    var html = '<div class="polaris-card polaris-fade-in">' +
      '<div class="polaris-section-heading">Recommended Actions</div>';
    for (var i = 0; i < recs.length; i++) {
      var rec = recs[i];
      html += '<div class="polaris-action-item">' +
        '<span class="polaris-action-bullet">→</span>' +
        '<span>' + H.esc(typeof rec === 'string' ? rec : (rec.message || rec.action || '')) + '</span>' +
      '</div>';
    }
    return html + '</div>';
  };

  C.ReasoningSection = function(data, opts) {
    if (!data) return '';
    var reasoning = data.reasoning || '';
    var description = data.description || '';

    // Build a concise explanation
    var parts = [];
    if (data.service) parts.push('Service: ' + data.service);
    if (data.region) parts.push('Region: ' + data.region);
    if (data.confidence != null) {
      var dp = 0;
      if (data.avgPrice || data.estimatedValue) dp++;
      if (description) dp++;
      if (data.customerId) dp += 2;
      if (data.address || data.jobAddress) dp++;
      parts.push('Data points: ' + dp);
    }
    if (data.profitMargin != null) parts.push('Profit margin: ' + Math.round(data.profitMargin) + '%');

    return '<div class="polaris-card polaris-fade-in">' +
      '<div class="polaris-section-heading">Decision Reasoning</div>' +
      '<div style="font-size:13px;color:var(--neutral-700,#374151);line-height:1.6;">' +
        (reasoning ? H.esc(reasoning) : '') +
        (parts.length > 0 ? (reasoning ? '<br><br>' : '') +
          '<div style="display:flex;flex-wrap:wrap;gap:8px;">' +
            parts.map(function(p) {
              return '<span style="font-size:11px;background:var(--neutral-100,#f3f4f6);padding:3px 8px;border-radius:4px;color:var(--neutral-600,#6b7280);">' + H.esc(p) + '</span>';
            }).join('') +
          '</div>' : '') +
        (!reasoning && parts.length === 0 ? 'No reasoning data available.' : '') +
      '</div>' +
    '</div>';
  };

  /* ─── Main Renderer ───────────────────────────────────── */

  function render(container, data, config) {
    if (!container) return;
    config = config || {};
    var context = config.context || 'lead';
    var sections = config.sections || ['Header', 'StatusBar', 'RevenueSection', 'EstimateSection', 'CustomerSection', 'OperationsSection', 'RisksSection', 'ActionsSection', 'ReasoningSection'];
    var loading = config.loading === true;

    // Inject CSS once
    if (!document.getElementById('polaris-ui-styles')) {
      var styleEl = document.createElement('style');
      styleEl.id = 'polaris-ui-styles';
      styleEl.textContent = CSS.replace(/<\/?style>/g, '');
      document.head.appendChild(styleEl);
    }

    // Loading state
    if (loading) {
      container.innerHTML =
        '<div class="polaris-fade-in">' +
          '<div class="polaris-card">' +
            H.skeleton('60%', '20px', { mb: '12px' }) +
            H.skeleton('40%', '14px') +
          '</div>' +
          '<div class="polaris-card">' +
            H.skeleton('100%', '14px', { mb: '8px' }) +
            H.skeleton('100%', '14px', { mb: '8px' }) +
            H.skeleton('80%', '14px') +
          '</div>' +
          '<div class="polaris-card">' +
            H.skeleton('50%', '14px', { mb: '8px' }) +
            H.skeleton('70%', '14px') +
          '</div>' +
        '</div>';
      return;
    }

    // Build HTML
    var html = '';
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      if (typeof C[section] === 'function') {
        html += C[section](data, { context: context });
      }
    }

    container.innerHTML = '<div class="polaris-fade-in">' + html + '</div>';
  }

  /* ─── Export ──────────────────────────────────────────── */

  window.PolarisUI = {
    render: render,
    components: C,
    helpers: H,
    css: CSS,
  };

})();