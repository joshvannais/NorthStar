(function (global) {
  'use strict';

  var root = document.getElementById('forecast-settings');
  if (!root) return;
  var status = document.getElementById('forecastSettingsStatus');
  var detail = document.getElementById('forecastSettingsDetail');
  var form = document.getElementById('forecastSettingsForm');
  var enabled = document.getElementById('forecastSettingsEnabled');
  var target = document.getElementById('forecastTargetInboundLeads');
  var priceTarget = document.getElementById('forecastTargetApprovedPrice');
  var week = document.getElementById('forecastHorizonWeek');
  var month = document.getElementById('forecastHorizonMonth');
  var quarter = document.getElementById('forecastHorizonQuarter');
  var scenario = document.getElementById('forecastScenarioDisplay');
  var comparison = document.getElementById('forecastComparisonDisplay');
  var alerts = document.getElementById('forecastAlerts');
  var save = document.getElementById('saveForecastSettings');
  var refresh = document.getElementById('refreshForecastSettings');
  var receipt = document.getElementById('forecastSettingsReceipt');
  var controls = [enabled, target, priceTarget, month, scenario, comparison, alerts];
  var current = null;
  var pending = null;

  function show(label, explanation, state) {
    status.textContent = label;
    detail.textContent = explanation;
    root.dataset.state = state;
  }
  function clear() {
    current = null;
    enabled.checked = false; target.checked = false; priceTarget.checked = false;
    week.value = ''; month.value = ''; quarter.value = '';
    scenario.value = 'withhold'; comparison.value = 'none'; alerts.checked = false;
    receipt.textContent = '';
    controls.forEach(function (control) { control.disabled = true; });
    save.disabled = true;
    save.textContent = 'Save reviewed settings';
  }
  function setEditable(value) {
    controls.forEach(function (control) { control.disabled = !value; });
    // Weekly and quarterly selections have no current released algorithm.
    week.disabled = true; quarter.disabled = true;
    save.disabled = !value;
  }
  function disabledSettings() {
    return { enabled: false, targets: [], horizons: [], scenarioDisplay: 'withhold',
      comparisonDisplay: 'none', alertDelivery: 'off', actionPolicy: 'review_required' };
  }
  function validSettings(value) {
    return value && typeof value === 'object' && typeof value.enabled === 'boolean' &&
      Array.isArray(value.targets) && Array.isArray(value.horizons) &&
      ['withhold','deterministic_when_eligible','calibrated_when_eligible']
        .includes(value.scenarioDisplay) &&
      ['none','prior','actual','prior_and_actual'].includes(value.comparisonDisplay) &&
      ['off','in_app_review_only'].includes(value.alertDelivery) &&
      value.actionPolicy === 'review_required';
  }
  function validData(data) {
    var gates = ['targetRegistrationProvenByPreference','algorithmPromotionProvenByPreference',
      'sourceAuthorityProvenByPreference','intervalCalibrationProvenByPreference',
      'actualFinalityProvenByPreference','issuanceEligibilityProvenByPreference',
      'forecastIssued','calibratedRangeIssued','automaticActionAuthorized'];
    if (!data || !['current','unavailable','superseded'].includes(data.state) ||
        gates.some(function (key) { return data[key] !== false; }) ||
        !data.authority || data.authority.automaticActionAuthorized !== false ||
        !data.authority.limits || data.authority.limits.targets !== 24 ||
        data.authority.limits.horizons !== 12 ||
        data.authority.limits.periodsPerHorizon !== 100) return false;
    if (data.state === 'unavailable') {
      return data.settings === null &&
        data.reason === 'selected_target_algorithm_or_source_authority_changed' &&
        data.recovery && data.recovery.action === 'disable' &&
        Number.isSafeInteger(data.recovery.expectedRevision) &&
        data.recovery.expectedRevision >= 1 &&
        typeof data.recovery.expectedDigest === 'string' &&
        /^[0-9a-f]{64}$/.test(data.recovery.expectedDigest);
    }
    if (data.state === 'superseded') {
      return data.settings === null && data.replayed === true &&
        data.historicalReceipt && data.currentReceipt &&
        Number.isSafeInteger(data.historicalReceipt.revision) &&
        Number.isSafeInteger(data.currentReceipt.revision) &&
        data.historicalReceipt.revision < data.currentReceipt.revision &&
        /^[0-9a-f]{64}$/.test(data.historicalReceipt.digest || '') &&
        /^[0-9a-f]{64}$/.test(data.currentReceipt.digest || '');
    }
    var value = data.settings;
    return value && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
      typeof value.digest === 'string' && /^[0-9a-f]{64}$/.test(value.digest) &&
      value.source && ['system_default','owner_reviewed'].includes(value.source.kind) &&
      validSettings(value.settings) && Array.isArray(data.authority.targets);
  }
  function render(data) {
    if (!validData(data)) throw new Error('Forecast settings response invalid');
    if (data.state === 'unavailable') {
      clear();
      current = { revision: data.recovery.expectedRevision,
        digest: data.recovery.expectedDigest };
      save.disabled = false;
      save.textContent = 'Save disabled reset';
      show('Forecast settings need a disabled reset',
        'A selected target, algorithm, or source permission is no longer current. Stale selections and receipts are withheld. An owner or administrator may record a new empty, disabled revision.',
        'review-required');
      return;
    }
    if (data.state === 'superseded') {
      clear(); pending = null;
      show('Earlier save receipt is superseded',
        'That retry belongs to an earlier revision. Values and receipts remain cleared until current settings are refreshed.',
        'unavailable');
      return;
    }
    var value = data.settings;
    var settings = value.settings;
    var targetAuthority = data.authority.targets.find(function (item) {
      return item.key === 'demand.inbound_leads' &&
        Array.isArray(item.supportedGrains) && item.supportedGrains.includes('month');
    });
    var priceAuthority = data.authority.targets.find(function (item) {
      return item.key === 'revenue.approved_price_flow' &&
        Array.isArray(item.supportedGrains) && item.supportedGrains.includes('month');
    });
    enabled.checked = settings.enabled;
    target.checked = settings.targets.includes('demand.inbound_leads');
    priceTarget.checked = settings.targets.includes('revenue.approved_price_flow');
    week.value = settings.horizons.find(function (item) { return item.grain === 'week'; })?.periods || '';
    month.value = settings.horizons.find(function (item) { return item.grain === 'month'; })?.periods || '';
    quarter.value = settings.horizons.find(function (item) { return item.grain === 'quarter'; })?.periods || '';
    scenario.value = settings.scenarioDisplay;
    comparison.value = settings.comparisonDisplay;
    alerts.checked = settings.alertDelivery === 'in_app_review_only';
    current = { revision: value.revision,
      digest: value.revision === 0 ? null : value.digest };
    if (pending && (pending.expectedRevision !== current.revision ||
        pending.expectedDigest !== current.digest)) pending = null;
    setEditable(Boolean(targetAuthority || priceAuthority));
    target.disabled = !targetAuthority;
    priceTarget.disabled = !priceAuthority;
    save.textContent = 'Save reviewed settings';
    receipt.textContent = value.revision === 0 ?
      'System default · no owner revision' :
      'Revision ' + value.revision + ' · ' + value.digest;
    if (!settings.enabled && value.revision === 0) {
      show('Forecast planning is off',
        'This conservative system default selects no targets or horizons. Ranges, comparisons, and alerts are withheld; every action requires review.',
        'current');
    } else if (!settings.enabled) {
      show('Forecast planning is off by reviewed preference',
        'An owner or administrator saved an empty, disabled revision. It does not issue a forecast or change source authority.',
        'current');
    } else if (!targetAuthority && !priceAuthority) {
      setEditable(false);
      show('Forecast settings review unavailable',
        'No current target and algorithm authority can accept a preference. Existing values remain read only.',
        'unavailable');
    } else {
      show('Forecast preferences recorded',
        'Preferences are ready for review. They do not prove source coverage, algorithm promotion, calibration, actual finality, or issuance eligibility.',
        'current');
    }
  }
  function applyEnabledState() {
    if (!enabled.checked) {
      target.checked = false; priceTarget.checked = false; month.value = '';
      scenario.value = 'withhold'; comparison.value = 'none'; alerts.checked = false;
    }
  }
  function settingsFromForm() {
    if (!enabled.checked) return disabledSettings();
    var periods = Number(month.value);
    var selected = [target.checked ? 'demand.inbound_leads' : null,
      priceTarget.checked ? 'revenue.approved_price_flow' : null].filter(Boolean);
    if (selected.length !== 1 || !Number.isInteger(periods) || periods < 1 || periods > 100) {
      throw new Error('Choose one current target and enter 1 to 100 monthly periods.');
    }
    return { enabled: true, targets: selected,
      horizons: [{ grain: 'month', periods: periods }],
      scenarioDisplay: scenario.value, comparisonDisplay: comparison.value,
      alertDelivery: alerts.checked ? 'in_app_review_only' : 'off',
      actionPolicy: 'review_required' };
  }
  async function load() {
    clear(); pending = null; refresh.disabled = true;
    show('Loading forecast settings…',
      'Values and receipts stay cleared until current owner authority is verified.', 'loading');
    var controller = new AbortController();
    var timer = global.setTimeout(function () { controller.abort(); }, 10000);
    try {
      if (!global.NorthStarAccountSession ||
          typeof global.NorthStarAccountSession.fetch !== 'function') throw new Error('Session unavailable');
      var response = await global.NorthStarAccountSession.fetch('/api/v1/forecast/settings', {
        credentials: 'same-origin', signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        clear();
        show(response.status === 401 ? 'Sign in required' : 'Access restricted',
          'Only a current paid-workspace owner or administrator can review forecast settings.',
          'unavailable'); return;
      }
      if (!response.ok) throw new Error('Forecast settings unavailable');
      var payload = await response.json();
      if (!payload || payload.success !== true) throw new Error('Forecast settings unavailable');
      render(payload.data);
    } catch (_error) {
      clear();
      show('Forecast settings unavailable',
        'NorthStar could not verify current settings. Refresh to recover; no earlier values or receipts are retained.',
        'unavailable');
    } finally { global.clearTimeout(timer); refresh.disabled = false; }
  }
  async function saveSettings(event) {
    event.preventDefault();
    if (!current || save.disabled) return;
    var settings;
    try { settings = settingsFromForm(); } catch (error) {
      show('Review the settings', error.message, 'invalid'); return;
    }
    if (!pending || pending.expectedRevision !== current.revision ||
        pending.expectedDigest !== current.digest ||
        JSON.stringify(pending.settings) !== JSON.stringify(settings)) {
      if (!global.crypto || typeof global.crypto.randomUUID !== 'function') {
        clear(); show('Save unavailable', 'Refresh before trying again.', 'unavailable'); return;
      }
      pending = { expectedRevision: current.revision, expectedDigest: current.digest,
        settings: settings, key: global.crypto.randomUUID() };
    }
    controls.forEach(function (control) { control.disabled = true; });
    save.disabled = true; refresh.disabled = true; receipt.textContent = '';
    show('Saving reviewed forecast settings…',
      'No forecast or automatic action is created by this preference.', 'loading');
    var controller = new AbortController();
    var timer = global.setTimeout(function () { controller.abort(); }, 10000);
    try {
      var response = await global.NorthStarAccountSession.fetch('/api/v1/forecast/settings', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key },
        body: JSON.stringify({ expectedRevision: pending.expectedRevision,
          expectedDigest: pending.expectedDigest, settings: pending.settings }),
      });
      if (response.status === 401 || response.status === 403) {
        clear();
        show(response.status === 401 ? 'Sign in required' : 'Access restricted',
          'The save was not confirmed. Sign in with current owner or administrator authority and refresh.',
          'unavailable'); return;
      }
      if (response.status === 400) {
        clear(); pending = null;
        show('Settings were not accepted',
          'The reviewed selection was invalid or no longer supported. Refresh before deciding again.',
          'invalid'); return;
      }
      if (response.status === 409) {
        clear();
        show('Settings changed; review again',
          'Another accepted revision or retry state is current. Refresh before deciding again.',
          'unavailable'); return;
      }
      if (!response.ok) throw new Error('Save unavailable');
      var payload = await response.json();
      if (!payload || payload.success !== true) throw new Error('Save receipt invalid');
      render(payload.data); pending = null;
    } catch (_error) {
      clear();
      show('Save result unconfirmed',
        'NorthStar could not confirm the result. Refresh to recover before trying again.',
        'unavailable');
    } finally { global.clearTimeout(timer); refresh.disabled = false; }
  }

  if (global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true) {
    clear(); refresh.hidden = true;
    show('Forecast planning is off in this fictional workspace',
      'This isolated demo saves nothing to a paid account. No targets or horizons are selected, ranges and comparisons are withheld, alerts are off, and every action requires review.',
      'demo');
    receipt.textContent = 'Fictional demo · no paid settings receipt';
    return;
  }
  enabled.addEventListener('change', applyEnabledState);
  target.addEventListener('change', function () { if (target.checked) priceTarget.checked = false; });
  priceTarget.addEventListener('change', function () { if (priceTarget.checked) target.checked = false; });
  form.addEventListener('submit', saveSettings);
  refresh.addEventListener('click', load);
  load();
})(window);
