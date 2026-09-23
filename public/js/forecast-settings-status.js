(function (global) {
  'use strict';

  var status = document.getElementById('forecastSettingsStatus');
  var detail = document.getElementById('forecastSettingsDetail');
  var refresh = document.getElementById('refreshForecastSettings');
  if (!status || !detail || !refresh) return;

  function show(label, explanation) {
    status.textContent = label;
    detail.textContent = explanation;
  }

  if (global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true) {
    show('Off in this sample workspace',
      'This is a fictional preview. No forecast preference was saved to a customer account, and no forecast has been issued.');
    refresh.hidden = true;
    return;
  }

  async function load() {
    refresh.disabled = true;
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
    } catch (_error) {
      show('Forecast status unavailable',
        'NorthStar could not verify the current preference. Try refreshing; no forecast value is shown here.');
    } finally {
      global.clearTimeout(timer);
      refresh.disabled = false;
    }
  }

  refresh.addEventListener('click', load);
  load();
})(window);
