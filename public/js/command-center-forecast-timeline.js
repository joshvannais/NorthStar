(function (global) {
  'use strict';

  var VERSION = 'm26-forecast-timeline-v1';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var DIGEST = /^[0-9a-f]{64}$/;
  var GRAINS = ['week', 'month', 'quarter'];
  var LABELS = ['Weekly', 'Monthly', 'Quarterly'];
  var REASONS = ['complete_saved_run_inventory_not_available',
    'deterministic_baseline_not_current'];

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

  function validSubject(value) {
    return exact(value, ['target','unit','horizon','scope','profile','sourceSnapshotDigest',
      'sourceReceiptDigest','baselineDigest','configurationDigest','algorithm']) &&
      exact(value.target, ['key','definitionVersion','sourceScope']) &&
      value.target.key === 'demand.inbound_leads' && value.target.definitionVersion === 'v1' &&
      value.target.sourceScope === 'retell_only_tenant_all' &&
      exact(value.unit, ['key','currency']) && value.unit.key === 'count' &&
      value.unit.currency === null &&
      exact(value.horizon, ['localStart','startsAt','endsAt','grain','timeZone']) &&
      value.horizon.grain === 'business_local_month' &&
      typeof value.horizon.timeZone === 'string' && value.horizon.timeZone.length > 0 &&
      exact(value.scope, ['sourceScope','serviceKey','areaKey','dimensionKeys']) &&
      value.scope.sourceScope === 'retell_only_tenant_all' && value.scope.serviceKey === null &&
      value.scope.areaKey === null && dense(value.scope.dimensionKeys, 0) &&
      exact(value.profile, ['businessProfileId','businessProfileVersion',
        'businessProfileHash','timeZone']) && UUID.test(value.profile.businessProfileId || '') &&
      value.profile.timeZone === value.horizon.timeZone &&
      ['sourceSnapshotDigest','sourceReceiptDigest','baselineDigest','configurationDigest']
        .every(function (key) { return DIGEST.test(value[key] || ''); }) &&
      exact(value.algorithm, ['key','version','definitionDigest','implementationDigest',
        'buildIdentity']) && value.algorithm.key === 'retell_three_complete_month_mean' &&
      value.algorithm.version === 'm26-retell-three-month-mean-v2' &&
      DIGEST.test(value.algorithm.definitionDigest || '') &&
      DIGEST.test(value.algorithm.implementationDigest || '') &&
      exact(value.algorithm.buildIdentity, ['kind','procedure']);
  }

  function validateTimeline(value) {
    var keys = ['version','state','reason','organizationId','originId','checkedAt',
      'comparisonMode','subject','periods','requirements','currentness','digests',
      'sourceAuthenticated','runInventoryComplete','actualSourceAuthenticated',
      'timelineIssued','paidNumericServing','automaticActionAuthorized','researchOnly'];
    if (!exact(value, keys) || value.version !== VERSION || value.state !== 'unavailable' ||
        REASONS.indexOf(value.reason) === -1 || !UUID.test(value.organizationId || '') ||
        !UUID.test(value.originId || '') || value.comparisonMode !== 'current_prior_actual' ||
        !dense(value.periods, 3) || !exact(value.currentness,
          ['baselineCurrent','runInventoryCurrent','actualsCurrent','refreshRequired',
            'correctionOrRevocationApplied']) ||
        value.currentness.runInventoryCurrent !== false ||
        value.currentness.actualsCurrent !== false || value.currentness.refreshRequired !== true ||
        !exact(value.digests, ['timeline','runInventory','actualInventory']) ||
        value.digests.runInventory !== null || value.digests.actualInventory !== null ||
        value.runInventoryComplete !== false || value.actualSourceAuthenticated !== false ||
        value.timelineIssued !== false || value.paidNumericServing !== false ||
        value.automaticActionAuthorized !== false || value.researchOnly !== true) return null;
    for (var index = 0; index < value.periods.length; index += 1) {
      var period = value.periods[index];
      if (!exact(period, ['grain','label','state','reason','startsAt','endsAt','partialPeriod',
        'current','prior','actual']) || period.grain !== GRAINS[index] ||
          period.label !== LABELS[index] || period.state !== 'unavailable' ||
          period.reason !== value.reason || ['startsAt','endsAt','partialPeriod',
            'current','prior','actual'].some(function (key) { return period[key] !== null; })) {
        return null;
      }
    }
    var current = value.reason === 'complete_saved_run_inventory_not_available';
    if (current ? (!validSubject(value.subject) || !DIGEST.test(value.digests.timeline || '') ||
      value.sourceAuthenticated !== true || value.currentness.baselineCurrent !== true ||
      value.currentness.correctionOrRevocationApplied !== false) :
      (value.subject !== null || value.digests.timeline !== null ||
        value.sourceAuthenticated !== false || value.currentness.baselineCurrent !== false ||
        value.currentness.correctionOrRevocationApplied !== true)) return null;
    return value;
  }

  function hash(character) { return character.repeat(64); }
  function demoTimeline(organizationId) {
    var value = {
      version: VERSION, state: 'unavailable',
      reason: 'complete_saved_run_inventory_not_available', organizationId: organizationId,
      originId: '90000000-0000-4000-8000-000000000010',
      checkedAt: '2026-10-08T12:00:00.000000Z', comparisonMode: 'current_prior_actual',
      subject: {
        target: { key: 'demand.inbound_leads', definitionVersion: 'v1',
          sourceScope: 'retell_only_tenant_all' }, unit: { key: 'count', currency: null },
        horizon: { localStart: '2026-11-01', startsAt: '2026-11-01T04:00:00.000000Z',
          endsAt: '2026-12-01T05:00:00.000000Z', grain: 'business_local_month',
          timeZone: 'America/New_York' },
        scope: { sourceScope: 'retell_only_tenant_all', serviceKey: null,
          areaKey: null, dimensionKeys: [] },
        profile: { businessProfileId: '10000000-0000-4000-8000-000000000001',
          businessProfileVersion: 1, businessProfileHash: hash('a'),
          timeZone: 'America/New_York' }, sourceSnapshotDigest: hash('b'),
        sourceReceiptDigest: hash('c'), baselineDigest: hash('d'),
        configurationDigest: hash('e'), algorithm: {
          key: 'retell_three_complete_month_mean', version: 'm26-retell-three-month-mean-v2',
          definitionDigest: hash('f'), implementationDigest: hash('1'), buildIdentity: {
            kind: 'postgresql_function_definition_sha256', procedure:
              'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)' } },
      },
      periods: GRAINS.map(function (grain, index) { return { grain: grain,
        label: LABELS[index], state: 'unavailable',
        reason: 'complete_saved_run_inventory_not_available', startsAt: null, endsAt: null,
        partialPeriod: null, current: null, prior: null, actual: null }; }),
      requirements: {
        completeRunInventory: { state: 'unavailable',
          reason: 'complete_saved_run_inventory_not_available', complete: false,
          inventoryDigest: null, runCount: null, currentRunId: null,
          currentRunDigest: null, priorRunId: null, priorRunDigest: null },
        issuanceChronology: { state: 'unavailable',
          reason: 'pre_outcome_issuance_chronology_not_available', verified: false,
          currentIssuedAt: null, priorIssuedAt: null },
        finalizedActuals: { state: 'unavailable',
          reason: 'authorized_finalized_actuals_not_available', sourceAuthenticated: false,
          outcomeFinalityPolicyVersion: null, outcomeFinalityPolicyDigest: null,
          actualInventoryDigest: null },
        businessCalendarBuckets: { state: 'unavailable',
          reason: 'compatible_business_calendar_buckets_not_available',
          timeZone: 'America/New_York', calendarDigest: null,
          partialPeriodsDisclosed: false, grains: GRAINS.slice() },
      },
      currentness: { baselineCurrent: true, runInventoryCurrent: false,
        actualsCurrent: false, refreshRequired: true, correctionOrRevocationApplied: false },
      digests: { timeline: hash('2'), runInventory: null, actualInventory: null },
      sourceAuthenticated: true, runInventoryComplete: false,
      actualSourceAuthenticated: false, timelineIssued: false,
      paidNumericServing: false, automaticActionAuthorized: false, researchOnly: true,
    };
    return value;
  }

  function reasonText(reason) {
    return reason === 'deterministic_baseline_not_current' ?
      'The source or profile changed. Refresh the authenticated origin before comparing periods.' :
      'A complete immutable run history and comparable finalized actuals are not available.';
  }

  function create(options) {
    var document = options.document;
    var fetcher = options.fetcher;
    var originProvider = options.originProvider;
    var mode = options.mode;
    var generation = 0;
    function byId(id) { return document.getElementById(id); }
    function setText(id, value) { var node = byId(id); if (node) node.textContent = value; }
    function clear(message) {
      generation += 1;
      var root = byId('commandCenterForecastTimeline');
      if (root) root.setAttribute('aria-busy', 'false');
      setText('commandCenterForecastTimelineState', 'Unavailable');
      setText('commandCenterForecastTimelineExplanation', message ||
        'No current forecast timeline is shown.');
      GRAINS.forEach(function (grain, index) {
        var name = LABELS[index].replace(/ly$/, '');
        setText('commandCenterForecastTimeline' + name + 'State', 'Unavailable');
        ['Current','Prior','Actual'].forEach(function (kind) {
          setText('commandCenterForecastTimeline' + name + kind, 'Not available');
        });
      });
      setText('commandCenterForecastTimelineAuthority',
        'No authenticated timeline identity is retained.');
      setText('commandCenterForecastTimelineBoundary',
        'Missing history stays unavailable. It is never shown as zero or as a later-created forecast.');
      setText('commandCenterForecastTimelineStatus',
        'Forecast timeline unavailable. No current, prior or actual value is shown.');
    }
    function render(value, authority) {
      var root = byId('commandCenterForecastTimeline');
      if (root) root.setAttribute('aria-busy', 'false');
      setText('commandCenterForecastTimelineState', authority.fictional ?
        'Fictional guard' : 'Timeline unavailable');
      setText('commandCenterForecastTimelineExplanation', authority.fictional ?
        'This isolated fictional example shows how NorthStar withholds a comparison until its full run history and finalized actuals are authenticated. It does not call paid forecast routes.' :
        reasonText(value.reason));
      value.periods.forEach(function (period, index) {
        var name = LABELS[index].replace(/ly$/, '');
        setText('commandCenterForecastTimeline' + name + 'State', 'Unavailable');
        ['Current','Prior','Actual'].forEach(function (kind) {
          setText('commandCenterForecastTimeline' + name + kind, 'Not available');
        });
      });
      var subject = value.subject;
      setText('commandCenterForecastTimelineAuthority', subject ?
        'Tenant ' + authority.tenantId + ' / ' + subject.target.key + '@' +
          subject.target.definitionVersion + ' / ' + subject.unit.key + ' / ' +
          subject.horizon.timeZone + ' / source ' + subject.sourceSnapshotDigest.slice(0, 12) +
          '. / timeline ' + value.digests.timeline.slice(0, 12) + '.' :
        'The prior authenticated subject was cleared because its source is no longer current.');
      setText('commandCenterForecastTimelineBoundary',
        'Current means an actually issued compatible run, prior means its compatible earlier issued run, and actual means a later-finalized source outcome. Missing evidence stays unavailable, never zero.');
      setText('commandCenterForecastTimelineStatus',
        'Weekly, monthly and quarterly comparisons remain unavailable. No current, prior or actual value is shown.');
    }
    function workspaceLoading() {
      clear('Checking the current timeline boundary.');
      var root = byId('commandCenterForecastTimeline');
      if (root) root.setAttribute('aria-busy', 'true');
      setText('commandCenterForecastTimelineState', 'Loading');
    }
    function workspaceUnavailable() {
      clear('Refresh the Command Center before reviewing forecast timelines.');
      setText('commandCenterForecastTimelineState', 'Workspace unavailable');
    }
    function workspaceReady(authority) {
      workspaceLoading();
      if (!authority || authority.mode !== mode || !UUID.test(authority.tenantId || '') ||
          !['owner','admin','viewer'].includes(authority.role) ||
          authority.fictional !== (mode === 'demo')) {
        workspaceUnavailable(); return Promise.resolve(false);
      }
      var active = generation;
      if (mode === 'demo') {
        var fictional = demoTimeline(authority.tenantId);
        if (!validateTimeline(fictional)) { workspaceUnavailable(); return Promise.resolve(false); }
        render(fictional, authority); return Promise.resolve(true);
      }
      if (!['owner','admin'].includes(authority.role)) {
        clear('Your current role cannot view private forecast timelines.'); return Promise.resolve(false);
      }
      var originId = originProvider && originProvider();
      if (!UUID.test(originId || '')) {
        clear('Choose a current authenticated demand origin before checking timeline availability.');
        return Promise.resolve(false);
      }
      return fetcher('/api/v1/forecast/timelines/' + encodeURIComponent(originId), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json' },
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (payload) {
          if (active !== generation || !response.ok || !payload || payload.success !== true) {
            throw new Error('unavailable');
          }
          var value = validateTimeline(payload.data);
          if (!value || value.organizationId !== authority.tenantId) throw new Error('unavailable');
          render(value, authority); return true;
        });
      }).catch(function () {
        if (active === generation) clear('Forecast timeline could not load. Refresh to try again.');
        return false;
      });
    }
    clear();
    return Object.freeze({ workspaceLoading: workspaceLoading,
      workspaceUnavailable: workspaceUnavailable, workspaceReady: workspaceReady });
  }

  global.NorthStarForecastTimeline = Object.freeze({ VERSION: VERSION,
    validateTimeline: validateTimeline, demoTimeline: demoTimeline, create: create });
})(window);
