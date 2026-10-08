(function (global) {
  'use strict';

  var VERSION = 'm26-forecast-drilldowns-v1';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var REASONS = ['same_run_manifest_not_available', 'deterministic_baseline_not_current'];
  var KEYS = ['revenue','operating_cost','profit','margin','demand','capacity'];

  function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var own = Reflect.ownKeys(value);
    return own.length === keys.length && own.every(function (key) {
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === 'string' && keys.indexOf(key) !== -1 && descriptor &&
        descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value');
    });
  }

  function dense(value, size) {
    if (!Array.isArray(value) || value.length !== size ||
        Reflect.ownKeys(value).length !== size + 1) return false;
    for (var index = 0; index < size; index += 1) {
      var descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor || !descriptor.enumerable ||
          !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return false;
    }
    return true;
  }

  function same(value, expected) {
    return JSON.stringify(value) === JSON.stringify(expected);
  }

  function copy(value) {
    return value === null ? null : JSON.parse(JSON.stringify(value));
  }

  function unavailableDetail() {
    return {
      sourceCoverage: { state: 'unavailable',
        reason: 'authenticated_complete_source_coverage_not_available', numerator: null,
        denominator: null, sourceKind: null, sourceScope: null, receiptDigest: null,
        complete: false },
      assumptions: { state: 'unavailable', reason: 'structured_assumption_lineage_not_available',
        lineageDigest: null, authorId: null, sourceKind: null, revision: null,
        applicabilityDigest: null, currentnessDigest: null, items: [] },
      confidence: { state: 'unavailable', reason: 'reviewed_evaluation_not_available',
        percentage: null, evaluationDigest: null, calibrated: false },
      uncertainty: { state: 'unavailable',
        reason: 'authenticated_uncertainty_drivers_not_available', drivers: [],
        evidenceDigest: null },
      staleInputs: { state: 'unavailable', reason: 'dependency_currentness_index_not_available',
        correctionRevocationDeletion: null, permissionRetention: null,
        profileCalendarConfigurationAlgorithm: null, supersededRevision: null,
        currentnessDigest: null },
      change: { state: 'unavailable',
        reason: 'compatible_prior_issued_point_forecast_not_available', amount: null,
        priorRunId: null, priorOutputDigest: null },
      error: { state: 'unavailable',
        reason: 'later_finalized_comparable_actual_not_available', amount: null,
        actualSourceDigest: null, outcomeFinalityDigest: null },
      cause: { state: 'unknown', reason: 'authenticated_lineage_difference_not_available',
        drivers: [], lineageDigest: null },
    };
  }

  function fromBundle(bundle) {
    var monthly = global.NorthStarMonthlyForecastKpis;
    if (!monthly || typeof monthly.validateBundle !== 'function' ||
        !monthly.validateBundle(bundle)) return null;
    return { version: VERSION, state: 'unavailable', reason: bundle.reason,
      organizationId: bundle.organizationId, originId: bundle.originId,
      checkedAt: bundle.checkedAt, bundle: copy(bundle), period: copy(bundle.month),
      slots: bundle.slots.map(function (slot) {
        return Object.assign({ key: slot.key, label: slot.label, state: 'unavailable',
          reason: bundle.reason, identity: { target: copy(slot.target), unit: copy(slot.unit),
            scope: copy(slot.scope), manifestEntryState: slot.manifestEntryState,
            runId: bundle.run.runId, runRevision: bundle.run.revision,
            outputDigest: slot.outputDigest, sourceSnapshotDigest: slot.sourceSnapshotDigest,
            currentnessDigest: slot.currentnessDigest } }, unavailableDetail());
      }), currentness: { anchorCurrent: bundle.currentness.anchorCurrent,
        manifestCurrent: false, detailReadersCurrent: false, refreshRequired: true,
        correctionOrRevocationApplied: bundle.currentness.correctionOrRevocationApplied },
      digests: { drilldown: null, bundle: bundle.digests.bundle,
        timeline: bundle.anchor ? bundle.anchor.timelineDigest : null, run: null, manifest: null },
      sourceCoverageAuthenticated: false, assumptionsAuthenticated: false,
      evaluationReviewed: false, staleInputAuthorityAvailable: false,
      numericalDetailIssued: false, paidNumericServing: false,
      automaticActionAuthorized: false, researchOnly: true };
  }

  function validDetail(value) {
    var coverage = value.sourceCoverage;
    var assumptions = value.assumptions;
    var confidence = value.confidence;
    var uncertainty = value.uncertainty;
    var stale = value.staleInputs;
    var change = value.change;
    var error = value.error;
    var cause = value.cause;
    return exact(coverage, ['state','reason','numerator','denominator','sourceKind','sourceScope',
      'receiptDigest','complete']) && coverage.state === 'unavailable' &&
      coverage.reason === 'authenticated_complete_source_coverage_not_available' &&
      ['numerator','denominator','sourceKind','sourceScope','receiptDigest']
        .every(function (key) { return coverage[key] === null; }) && coverage.complete === false &&
      exact(assumptions, ['state','reason','lineageDigest','authorId','sourceKind','revision',
        'applicabilityDigest','currentnessDigest','items']) && assumptions.state === 'unavailable' &&
      assumptions.reason === 'structured_assumption_lineage_not_available' &&
      ['lineageDigest','authorId','sourceKind','revision','applicabilityDigest','currentnessDigest']
        .every(function (key) { return assumptions[key] === null; }) && dense(assumptions.items, 0) &&
      exact(confidence, ['state','reason','percentage','evaluationDigest','calibrated']) &&
      confidence.state === 'unavailable' && confidence.reason === 'reviewed_evaluation_not_available' &&
      confidence.percentage === null && confidence.evaluationDigest === null &&
      confidence.calibrated === false &&
      exact(uncertainty, ['state','reason','drivers','evidenceDigest']) &&
      uncertainty.state === 'unavailable' &&
      uncertainty.reason === 'authenticated_uncertainty_drivers_not_available' &&
      dense(uncertainty.drivers, 0) && uncertainty.evidenceDigest === null &&
      exact(stale, ['state','reason','correctionRevocationDeletion','permissionRetention',
        'profileCalendarConfigurationAlgorithm','supersededRevision','currentnessDigest']) &&
      stale.state === 'unavailable' && stale.reason === 'dependency_currentness_index_not_available' &&
      ['correctionRevocationDeletion','permissionRetention',
        'profileCalendarConfigurationAlgorithm','supersededRevision','currentnessDigest']
        .every(function (key) { return stale[key] === null; }) &&
      exact(change, ['state','reason','amount','priorRunId','priorOutputDigest']) &&
      change.state === 'unavailable' &&
      change.reason === 'compatible_prior_issued_point_forecast_not_available' &&
      ['amount','priorRunId','priorOutputDigest'].every(function (key) { return change[key] === null; }) &&
      exact(error, ['state','reason','amount','actualSourceDigest','outcomeFinalityDigest']) &&
      error.state === 'unavailable' &&
      error.reason === 'later_finalized_comparable_actual_not_available' &&
      ['amount','actualSourceDigest','outcomeFinalityDigest']
        .every(function (key) { return error[key] === null; }) &&
      exact(cause, ['state','reason','drivers','lineageDigest']) && cause.state === 'unknown' &&
      cause.reason === 'authenticated_lineage_difference_not_available' &&
      dense(cause.drivers, 0) && cause.lineageDigest === null;
  }

  function validateDrilldowns(value) {
    var keys = ['version','state','reason','organizationId','originId','checkedAt','bundle','period',
      'slots','currentness','digests','sourceCoverageAuthenticated','assumptionsAuthenticated',
      'evaluationReviewed','staleInputAuthorityAvailable','numericalDetailIssued',
      'paidNumericServing','automaticActionAuthorized','researchOnly'];
    var monthly = global.NorthStarMonthlyForecastKpis;
    if (!exact(value, keys) || value.version !== VERSION || value.state !== 'unavailable' ||
        REASONS.indexOf(value.reason) === -1 || !UUID.test(value.organizationId || '') ||
        !UUID.test(value.originId || '') || !monthly ||
        typeof monthly.validateBundle !== 'function') return null;
    var bundle = monthly.validateBundle(value.bundle);
    if (!bundle || value.organizationId !== bundle.organizationId ||
        value.originId !== bundle.originId || value.checkedAt !== bundle.checkedAt ||
        value.reason !== bundle.reason || !same(value.period, bundle.month) ||
        !dense(value.slots, KEYS.length)) return null;
    if (!value.slots.every(function (slot, index) {
      var source = bundle.slots[index];
      return exact(slot, ['key','label','state','reason','identity','sourceCoverage','assumptions',
        'confidence','uncertainty','staleInputs','change','error','cause']) &&
        slot.key === KEYS[index] && slot.key === source.key && slot.label === source.label &&
        slot.state === 'unavailable' && slot.reason === value.reason &&
        exact(slot.identity, ['target','unit','scope','manifestEntryState','runId','runRevision',
          'outputDigest','sourceSnapshotDigest','currentnessDigest']) &&
        same(slot.identity.target, source.target) && same(slot.identity.unit, source.unit) &&
        same(slot.identity.scope, source.scope) &&
        slot.identity.manifestEntryState === source.manifestEntryState &&
        slot.identity.runId === bundle.run.runId &&
        slot.identity.runRevision === bundle.run.revision &&
        slot.identity.outputDigest === source.outputDigest &&
        slot.identity.sourceSnapshotDigest === source.sourceSnapshotDigest &&
        slot.identity.currentnessDigest === source.currentnessDigest && validDetail(slot);
    })) return null;
    if (!exact(value.currentness, ['anchorCurrent','manifestCurrent','detailReadersCurrent',
      'refreshRequired','correctionOrRevocationApplied']) ||
        value.currentness.anchorCurrent !== bundle.currentness.anchorCurrent ||
        value.currentness.manifestCurrent !== false ||
        value.currentness.detailReadersCurrent !== false ||
        value.currentness.refreshRequired !== true ||
        value.currentness.correctionOrRevocationApplied !==
          bundle.currentness.correctionOrRevocationApplied ||
        !exact(value.digests, ['drilldown','bundle','timeline','run','manifest']) ||
        value.digests.drilldown !== null || value.digests.bundle !== bundle.digests.bundle ||
        value.digests.timeline !== (bundle.anchor ? bundle.anchor.timelineDigest : null) ||
        value.digests.run !== null || value.digests.manifest !== null ||
        value.sourceCoverageAuthenticated !== false ||
        value.assumptionsAuthenticated !== false || value.evaluationReviewed !== false ||
        value.staleInputAuthorityAvailable !== false || value.numericalDetailIssued !== false ||
        value.paidNumericServing !== false || value.automaticActionAuthorized !== false ||
        value.researchOnly !== true) return null;
    return value;
  }

  function demoDrilldowns(organizationId) {
    var monthly = global.NorthStarMonthlyForecastKpis;
    return monthly && typeof monthly.demoBundle === 'function' ?
      fromBundle(monthly.demoBundle(organizationId)) : null;
  }

  function suffix(key) {
    return key.replace(/(^|_)(.)/g,
      function (_match, _prefix, character) { return character.toUpperCase(); });
  }

  function create(options) {
    var document = options.document;
    var mode = options.mode;
    var fetcher = options.fetcher;
    var originProvider = options.originProvider;
    var generation = 0;
    function byId(id) { return document.getElementById(id); }
    function setText(id, text) { var node = byId(id); if (node) node.textContent = text; }
    function detailText(slot) {
      var name = suffix(slot.key);
      setText('commandCenterForecastDrilldown' + name + 'Coverage',
        'Not available — complete numerator, denominator and source receipt are not authenticated.');
      setText('commandCenterForecastDrilldown' + name + 'Assumptions',
        'Not available — structured author, source, revision, applicability and currentness lineage is missing.');
      setText('commandCenterForecastDrilldown' + name + 'Confidence',
        'Not available — no reviewed evaluation supports probability, calibration or a confidence percentage.');
      setText('commandCenterForecastDrilldown' + name + 'Uncertainty',
        'Not available — no authenticated uncertainty drivers are available.');
      setText('commandCenterForecastDrilldown' + name + 'Stale',
        'Unknown — dependency currentness for corrections, permissions, retention, profile, calendar, configuration, algorithm and revisions is unavailable.');
      setText('commandCenterForecastDrilldown' + name + 'Change',
        'Not available — no compatible prior issued point forecast is authenticated.');
      setText('commandCenterForecastDrilldown' + name + 'Error',
        'Not available — no comparable later-finalized actual is authenticated.');
      setText('commandCenterForecastDrilldown' + name + 'Cause',
        'Unknown — no authenticated source, feature, assumption, configuration or algorithm difference establishes why a value changed.');
    }
    function clear(message) {
      generation += 1;
      var root = byId('commandCenterForecastDrilldowns');
      if (root) { root.setAttribute('aria-busy', 'false'); root.open = false; }
      setText('commandCenterForecastDrilldownsState', 'Unavailable');
      setText('commandCenterForecastDrilldownsExplanation', message ||
        'No forecast evidence detail is shown.');
      KEYS.forEach(function (key) { detailText({ key: key }); });
      setText('commandCenterForecastDrilldownsAuthority',
        'No authenticated run, period or drilldown identity is retained.');
      setText('commandCenterForecastDrilldownsBoundary',
        'Unavailable detail remains value-free. Zero is shown only from complete authenticated evidence.');
      setText('commandCenterForecastDrilldownsStatus',
        'Forecast drilldowns unavailable. No coverage count, assumption, confidence, uncertainty driver, change, error or cause is shown.');
    }
    function render(value, authority) {
      var root = byId('commandCenterForecastDrilldowns');
      if (root) root.setAttribute('aria-busy', 'false');
      setText('commandCenterForecastDrilldownsState', authority.fictional ?
        'Fictional guard' : 'Details unavailable');
      setText('commandCenterForecastDrilldownsExplanation', authority.fictional ?
        'This isolated fictional example uses the same guarded drilldown state. It makes no paid request and supplies no invented evidence.' :
        (value.reason === 'deterministic_baseline_not_current' ?
          'The source anchor changed, so every previous detail was cleared.' :
          'The current source anchor exists, but an immutable run manifest, structured lineage, reviewed evaluation and finalized actuals do not.'));
      value.slots.forEach(detailText);
      setText('commandCenterForecastDrilldownsAuthority', value.bundle.anchor ?
        'Tenant ' + authority.tenantId + ' / month ' + value.period.localStart + ' ' +
          value.period.timeZone + ' / timeline ' + value.digests.timeline.slice(0, 12) +
          '… / bundle ' + value.digests.bundle.slice(0, 12) +
          '… / run and drilldown receipts unavailable.' :
        'The prior source, month and digest identities were cleared because they are not current.');
      setText('commandCenterForecastDrilldownsBoundary',
        'A signed change needs compatible pre-outcome point forecasts. Forecast error needs a later-finalized comparable actual. A numerical delta alone never explains cause.');
      setText('commandCenterForecastDrilldownsStatus',
        'Six forecast drilldowns remain value-free and unavailable under the current guarded evidence boundary.');
    }
    function workspaceLoading() {
      clear('Checking source, lineage, evaluation and currentness evidence.');
      var root = byId('commandCenterForecastDrilldowns');
      if (root) root.setAttribute('aria-busy', 'true');
      setText('commandCenterForecastDrilldownsState', 'Loading');
    }
    function workspaceUnavailable() {
      clear('Refresh the Command Center before reviewing forecast evidence detail.');
      setText('commandCenterForecastDrilldownsState', 'Workspace unavailable');
    }
    function workspaceReady(authority) {
      workspaceLoading();
      if (!authority || authority.mode !== mode || !UUID.test(authority.tenantId || '') ||
          ['owner','admin','viewer'].indexOf(authority.role) === -1 ||
          authority.fictional !== (mode === 'demo')) {
        workspaceUnavailable(); return Promise.resolve(false);
      }
      var active = generation;
      if (mode === 'demo') {
        var fictional = demoDrilldowns(authority.tenantId);
        if (!validateDrilldowns(fictional)) { workspaceUnavailable(); return Promise.resolve(false); }
        render(fictional, authority); return Promise.resolve(true);
      }
      if (['owner','admin'].indexOf(authority.role) === -1) {
        clear('Your current role cannot view private forecast evidence detail.');
        return Promise.resolve(false);
      }
      var originId = originProvider && originProvider();
      if (!UUID.test(originId || '')) {
        clear('Choose a current authenticated demand origin before checking forecast detail.');
        return Promise.resolve(false);
      }
      return fetcher('/api/v1/forecast/drilldowns/' + encodeURIComponent(originId), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json' },
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (payload) {
          if (active !== generation || !response.ok || !payload || payload.success !== true) {
            throw new Error('unavailable');
          }
          var value = validateDrilldowns(payload.data);
          if (!value || value.organizationId !== authority.tenantId) throw new Error('unavailable');
          render(value, authority); return true;
        });
      }).catch(function () {
        if (active === generation) clear('Forecast detail could not load. Refresh to try again.');
        return false;
      });
    }
    clear();
    return Object.freeze({ workspaceLoading: workspaceLoading,
      workspaceUnavailable: workspaceUnavailable, workspaceReady: workspaceReady });
  }

  global.NorthStarForecastDrilldowns = Object.freeze({ VERSION: VERSION,
    fromBundle: fromBundle, validateDrilldowns: validateDrilldowns,
    demoDrilldowns: demoDrilldowns, create: create });
})(window);
