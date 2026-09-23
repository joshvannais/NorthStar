(function (global) {
  'use strict';

  var status = document.getElementById('forecastSettingsStatus');
  var detail = document.getElementById('forecastSettingsDetail');
  var refresh = document.getElementById('refreshForecastSettings');
  var reviewHint = document.getElementById('forecastSettingsReviewHint');
  var recordOff = document.getElementById('recordForecastsOff');
  if (!status || !detail || !refresh || !reviewHint || !recordOff) return;
  var current = null;
  var pending = null;

  function hideAction() {
    recordOff.hidden = true;
    reviewHint.hidden = true;
    recordOff.disabled = true;
  }

  function show(label, explanation) {
    status.textContent = label;
    detail.textContent = explanation;
  }

  if (global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true) {
    show('Off in this sample workspace',
      'This is a fictional preview. No forecast preference was saved to a customer account, and no forecast has been issued.');
    refresh.hidden = true;
    hideAction();
    return;
  }

  async function load() {
    refresh.disabled = true;
    hideAction();
    current = null;
    show('Checking forecast status…', 'No forecast value is shown while the source check is pending.');
    var controller = new AbortController();
    var timer = global.setTimeout(function () { controller.abort(); }, 10000);
    try {
      if (!global.NorthStarAccountSession ||
          typeof global.NorthStarAccountSession.fetch !== 'function') {
        throw new Error('Account session unavailable');
      }
      var response = await global.NorthStarAccountSession.fetch('/api/v1/forecast/settings', {
        credentials: 'same-origin', signal: controller.signal,
      });
      if (response.status === 401) {
        show('Sign in required', 'Sign in to view this workspace’s forecast preference.');
        return;
      }
      if (response.status === 403) {
        show('Access restricted', 'Only an authorized owner or administrator can view this forecast preference.');
        return;
      }
      if (!response.ok) throw new Error('Forecast settings unavailable');
      var payload = await response.json();
      var value = payload && payload.success === true && payload.data && payload.data.settings;
      if (!value || !value.settings || typeof value.settings.enabled !== 'boolean' ||
          !Number.isSafeInteger(value.revision) || value.revision < 0 ||
          typeof value.digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.digest) ||
          !value.source || !['system_default', 'owner_reviewed'].includes(value.source.kind) ||
          payload.data.forecastIssued !== false ||
          payload.data.sourceEligibilityVerified !== false) {
        throw new Error('Forecast settings response invalid');
      }
      if (value.settings.enabled) {
        show('Preference recorded; forecast unavailable',
          'A saved preference does not verify source coverage or issue a forecast. Review the forecast outlook for current availability.');
      } else if (value.revision === 0 && value.source.kind === 'system_default') {
        show('Forecast planning is off',
          'This is the cautious system default. No owner preference has been recorded and no forecast has been issued.');
      } else if (value.revision > 0 && value.source.kind === 'owner_reviewed') {
        show('Forecast planning is off by saved workspace preference',
          'An authorized owner or administrator recorded this preference. It does not erase historical source data or issue a forecast.');
      } else {
        throw new Error('Forecast settings lineage invalid');
      }
      current = { revision: value.revision,
        digest: value.revision === 0 ? null : value.digest };
      if (pending && (pending.expectedRevision !== current.revision ||
          pending.expectedDigest !== current.digest)) pending = null;
      if (value.settings.enabled || value.revision === 0) {
        reviewHint.hidden = false;
        recordOff.hidden = false;
        recordOff.disabled = false;
      }
    } catch (_error) {
      show('Forecast status unavailable',
        'NorthStar could not verify the current preference. Try refreshing; no forecast value is shown here.');
    } finally {
      global.clearTimeout(timer);
      refresh.disabled = false;
    }
  }

  async function saveOff() {
    if (!current || recordOff.disabled) return;
    var revision = current.revision;
    var digest = current.digest;
    if (!pending || pending.expectedRevision !== revision ||
        pending.expectedDigest !== digest) {
      if (!global.crypto || typeof global.crypto.randomUUID !== 'function') {
        show('Preference could not be saved', 'Refresh and try again. No change was confirmed.');
        return;
      }
      pending = { expectedRevision: revision, expectedDigest: digest,
        key: global.crypto.randomUUID(), body: {
          expectedRevision: revision, expectedDigest: digest,
          settings: { enabled: false, targets: [], horizons: [],
            scenarioDisplay: 'withhold', comparisonDisplay: 'none',
            alertDelivery: 'off', actionPolicy: 'review_required' }
        } };
    }
    recordOff.disabled = true;
    refresh.disabled = true;
    show('Recording your preference…',
      'This records a reviewed workspace preference. It does not issue a forecast.');
    var controller = new AbortController();
    var timer = global.setTimeout(function () { controller.abort(); }, 10000);
    try {
      var response = await global.NorthStarAccountSession.fetch('/api/v1/forecast/settings', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json',
          'Idempotency-Key': pending.key },
        body: JSON.stringify(pending.body),
      });
      if (response.status === 401 || response.status === 403) {
        hideAction();
        show(response.status === 401 ? 'Sign in required' : 'Access restricted',
          'NorthStar could not confirm a saved preference. Sign in with an authorized workspace account and refresh.');
        return;
      }
      if (response.status === 409) {
        hideAction();
        pending = null;
        show('Preference changed',
          'Another change was recorded. Refresh the current preference before deciding again.');
        return;
      }
      if (!response.ok) throw new Error('Forecast settings save unavailable');
      var payload = await response.json();
      var saved = payload && payload.success === true && payload.data && payload.data.settings;
      if (!saved || saved.revision !== revision + 1 ||
          saved.source?.kind !== 'owner_reviewed' ||
          saved.settings?.enabled !== false ||
          typeof saved.digest !== 'string' || !/^[0-9a-f]{64}$/.test(saved.digest) ||
          payload.data.forecastIssued !== false ||
          payload.data.sourceEligibilityVerified !== false) {
        throw new Error('Forecast settings save receipt invalid');
      }
      pending = null;
      hideAction();
      show('Forecast planning is off by saved workspace preference',
        'An authorized owner or administrator recorded this preference. It does not erase historical source data or issue a forecast.');
      current = { revision: saved.revision, digest: saved.digest };
    } catch (_error) {
      hideAction();
      show('Save result unconfirmed',
        'NorthStar could not confirm whether the preference was saved. Refresh to check before trying again.');
    } finally {
      global.clearTimeout(timer);
      refresh.disabled = false;
    }
  }

  refresh.addEventListener('click', load);
  recordOff.addEventListener('click', saveOff);
  load();
})(window);
