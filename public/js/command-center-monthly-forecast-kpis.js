(function (global) {
  'use strict';

  var VERSION = 'm26-monthly-kpi-bundle-v1';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var DIGEST = /^[0-9a-f]{64}$/;
  var INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
  var MONTH = /^\d{4}-(?:0[1-9]|1[0-2])-01$/;
  var REASONS = ['same_run_manifest_not_available', 'deterministic_baseline_not_current'];
  var SPECS = [
    { key: 'revenue', label: 'Revenue', targetKey: 'revenue.earned_value', version: 'v1',
      status: 'cataloged', components: [], unit: 'money', scope: 'authorized_earned_value', dimension: 'none' },
    { key: 'operating_cost', label: 'Operating cost', targetKey: null, version: null,
      status: 'derived_display_metric_not_registered', components: ['cost.accepted_labor.v1',
        'cost.accepted_material.v1','cost.accepted_asset_travel.v1','cost.accepted_overhead.v1'],
      unit: 'money', scope: 'complete_non_overlapping_operating_cost_categories', dimension: 'none' },
    { key: 'profit', label: 'Profit', targetKey: null, version: null,
      status: 'derived_display_metric_not_registered', components: ['revenue.earned_value.v1',
        'cost.accepted_labor.v1','cost.accepted_material.v1','cost.accepted_asset_travel.v1',
        'cost.accepted_overhead.v1'], unit: 'money',
      scope: 'compatible_earned_revenue_less_operating_cost', dimension: 'none' },
    { key: 'margin', label: 'Margin', targetKey: 'profit.operating_margin', version: 'v1',
      status: 'cataloged', components: ['revenue.earned_value.v1','cost.accepted_labor.v1',
        'cost.accepted_material.v1','cost.accepted_asset_travel.v1','cost.accepted_overhead.v1'],
      unit: 'ratio', scope: 'compatible_positive_revenue_and_operating_cost', dimension: 'none' },
    { key: 'demand', label: 'Demand', targetKey: 'demand.inbound_leads', version: 'v1',
      status: 'cataloged', components: [], unit: 'count',
      scope: 'declared_complete_eligible_channels', dimension: 'none' },
    { key: 'capacity', label: 'Capacity', targetKey: 'capacity.available_role_hours', version: 'v1',
      status: 'cataloged', components: [], unit: 'role_hours',
      scope: 'qualified_available_role_hours', dimension: 'role' },
  ];

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

  function validInstant(value) {
    if (typeof value !== 'string' || !INSTANT.test(value)) return false;
    var milliseconds = Date.parse(value.slice(0, 23) + 'Z');
    return Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString().slice(0, 23) === value.slice(0, 23);
  }

  function validAnchor(value) {
    return exact(value, ['originId','timelineDigest','target','unit','horizon','scope','profile',
      'sourceSnapshotDigest','sourceReceiptDigest','baselineDigest','configurationDigest','algorithm']) &&
      UUID.test(value.originId || '') && DIGEST.test(value.timelineDigest || '') &&
      exact(value.target, ['key','definitionVersion','sourceScope']) &&
      value.target.key === 'demand.inbound_leads' && value.target.definitionVersion === 'v1' &&
      value.target.sourceScope === 'retell_only_tenant_all' &&
      exact(value.unit, ['key','currency']) && value.unit.key === 'count' && value.unit.currency === null &&
      exact(value.horizon, ['localStart','startsAt','endsAt','grain','timeZone']) &&
      MONTH.test(value.horizon.localStart || '') && validInstant(value.horizon.startsAt) &&
      validInstant(value.horizon.endsAt) && value.horizon.startsAt < value.horizon.endsAt &&
      value.horizon.grain === 'business_local_month' &&
      exact(value.scope, ['sourceScope','serviceKey','areaKey','dimensionKeys']) &&
      value.scope.sourceScope === 'retell_only_tenant_all' && value.scope.serviceKey === null &&
      value.scope.areaKey === null && dense(value.scope.dimensionKeys, 0) &&
      exact(value.profile, ['businessProfileId','businessProfileVersion','businessProfileHash','timeZone']) &&
      UUID.test(value.profile.businessProfileId || '') &&
      Number.isSafeInteger(value.profile.businessProfileVersion) &&
      value.profile.businessProfileVersion > 0 && DIGEST.test(value.profile.businessProfileHash || '') &&
      value.profile.timeZone === value.horizon.timeZone &&
      ['sourceSnapshotDigest','sourceReceiptDigest','baselineDigest','configurationDigest']
        .every(function (key) { return DIGEST.test(value[key] || ''); }) &&
      exact(value.algorithm, ['key','version','definitionDigest','implementationDigest','buildIdentity']) &&
      value.algorithm.key === 'retell_three_complete_month_mean' &&
      value.algorithm.version === 'm26-retell-three-month-mean-v2' &&
      DIGEST.test(value.algorithm.definitionDigest || '') &&
      DIGEST.test(value.algorithm.implementationDigest || '') &&
      exact(value.algorithm.buildIdentity, ['kind','procedure']) &&
      value.algorithm.buildIdentity.kind === 'postgresql_function_definition_sha256' &&
      value.algorithm.buildIdentity.procedure ===
        'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)';
  }

  function validMonth(value, anchor) {
    return exact(value, ['localStart','startsAt','endsAt','grain','timeZone','calendarDigest','partialPeriod']) &&
      MONTH.test(value.localStart || '') && validInstant(value.startsAt) && validInstant(value.endsAt) &&
      value.startsAt < value.endsAt && value.grain === 'business_local_month' &&
      value.localStart === anchor.horizon.localStart && value.startsAt === anchor.horizon.startsAt &&
      value.endsAt === anchor.horizon.endsAt &&
      value.timeZone === anchor.profile.timeZone && value.calendarDigest === null &&
      value.partialPeriod === null;
  }

  function validRun(value) {
    return exact(value, ['state','reason','runId','revision','predictionCutoff','manifestDigest',
      'algorithmSetDigest','configurationDigest','sourceSnapshotDigest','complete','current']) &&
      value.state === 'unavailable' && value.reason === 'same_run_manifest_not_available' &&
      value.complete === false && value.current === false &&
      ['runId','revision','predictionCutoff','manifestDigest','algorithmSetDigest',
        'configurationDigest','sourceSnapshotDigest'].every(function (key) { return value[key] === null; });
  }

  function validSlot(value, spec, reason) {
    return exact(value, ['key','label','state','reason','target','unit','scope','manifestEntryState',
      'value','outputDigest','sourceSnapshotDigest','coverageDigest','currentnessDigest']) &&
      value.key === spec.key && value.label === spec.label && value.state === 'unavailable' &&
      value.reason === reason && exact(value.target, ['key','definitionVersion','status','componentTargets']) &&
      value.target.key === spec.targetKey && value.target.definitionVersion === spec.version &&
      value.target.status === spec.status && dense(value.target.componentTargets, spec.components.length) &&
      value.target.componentTargets.every(function (item, index) { return item === spec.components[index]; }) &&
      exact(value.unit, ['key','currency']) && value.unit.key === spec.unit && value.unit.currency === null &&
      exact(value.scope, ['sourceScope','serviceKey','areaKey','dimensionKind','dimensionValue','dimensionDigest']) &&
      value.scope.sourceScope === spec.scope && value.scope.serviceKey === null && value.scope.areaKey === null &&
      value.scope.dimensionKind === spec.dimension && value.scope.dimensionValue === null &&
      value.scope.dimensionDigest === null && value.manifestEntryState === 'unknown_manifest_unavailable' &&
      ['value','outputDigest','sourceSnapshotDigest','coverageDigest','currentnessDigest']
        .every(function (key) { return value[key] === null; });
  }

  function validRequirements(value) {
    if (!exact(value, ['sameRunManifest','earnedRevenueAuthority','operatingCostCoverage',
      'demandCoverage','capacityScope'])) return false;
    var manifest = value.sameRunManifest;
    var revenue = value.earnedRevenueAuthority;
    var cost = value.operatingCostCoverage;
    var demand = value.demandCoverage;
    var capacity = value.capacityScope;
    return exact(manifest, ['state','reason','complete','runId','revision','predictionCutoff',
      'manifestDigest','presentTargetCount','expectedTargetCount','absentTargets']) &&
      manifest.state === 'unavailable' && manifest.reason === 'same_run_manifest_not_available' &&
      manifest.complete === false && manifest.expectedTargetCount === 6 &&
      ['runId','revision','predictionCutoff','manifestDigest','presentTargetCount','absentTargets']
        .every(function (key) { return manifest[key] === null; }) &&
      exact(revenue, ['state','reason','recognitionPolicyVersion','recognitionPolicyDigest',
        'completeEventTimeCoverage']) && revenue.state === 'unavailable' &&
      revenue.reason === 'authorized_earned_revenue_not_available' &&
      revenue.recognitionPolicyVersion === null && revenue.recognitionPolicyDigest === null &&
      revenue.completeEventTimeCoverage === false &&
      exact(cost, ['state','reason','costBasisVersion','costBasisDigest','currency','categoriesComplete',
        'nonOverlapping','longJobAllocationVerified']) && cost.state === 'unavailable' &&
      cost.reason === 'complete_operating_cost_categories_not_available' &&
      ['costBasisVersion','costBasisDigest','currency'].every(function (key) { return cost[key] === null; }) &&
      cost.categoriesComplete === false && cost.nonOverlapping === false &&
      cost.longJobAllocationVerified === false &&
      exact(demand, ['state','reason','eligibleChannelScope','distinctLeadIdentityComplete',
        'rawRetellCallsSeparated']) && demand.state === 'unavailable' &&
      demand.reason === 'same_run_demand_target_not_available' && demand.eligibleChannelScope === null &&
      demand.distinctLeadIdentityComplete === false && demand.rawRetellCallsSeparated === true &&
      exact(capacity, ['state','reason','roleKey','dimensionDigest','qualifiedAvailabilityComplete',
        'commitmentOverlapReviewed']) && capacity.state === 'unavailable' &&
      capacity.reason === 'same_run_role_capacity_target_not_available' && capacity.roleKey === null &&
      capacity.dimensionDigest === null && capacity.qualifiedAvailabilityComplete === false &&
      capacity.commitmentOverlapReviewed === false;
  }

  function validateBundle(value) {
    var keys = ['version','state','reason','organizationId','originId','checkedAt','anchor','month','run',
      'slots','requirements','graph','currentness','digests','anchorSourceAuthenticated',
      'sameRunManifestComplete','bundleIssued','paidNumericServing','automaticActionAuthorized','researchOnly'];
    if (!exact(value, keys) || value.version !== VERSION || value.state !== 'unavailable' ||
        REASONS.indexOf(value.reason) === -1 || !UUID.test(value.organizationId || '') ||
        !UUID.test(value.originId || '') || !validInstant(value.checkedAt) || !validRun(value.run) ||
        !dense(value.slots, SPECS.length) ||
        !value.slots.every(function (slot, index) { return validSlot(slot, SPECS[index], value.reason); }) ||
        !validRequirements(value.requirements) ||
        !exact(value.graph, ['state','reason','month','series']) || value.graph.state !== 'unavailable' ||
        value.graph.reason !== value.reason || !dense(value.graph.series, SPECS.length) ||
        !value.graph.series.every(function (series, index) {
          return exact(series, ['key','value','unitKey']) && series.key === SPECS[index].key &&
            series.value === null && series.unitKey === SPECS[index].unit;
        }) || !exact(value.currentness, ['anchorCurrent','manifestCurrent','sourceReadersCurrent',
          'refreshRequired','correctionOrRevocationApplied']) ||
        value.currentness.manifestCurrent !== false || value.currentness.sourceReadersCurrent !== false ||
        value.currentness.refreshRequired !== true ||
        !exact(value.digests, ['bundle','run','manifest']) || value.digests.run !== null ||
        value.digests.manifest !== null || value.sameRunManifestComplete !== false ||
        value.bundleIssued !== false || value.paidNumericServing !== false ||
        value.automaticActionAuthorized !== false || value.researchOnly !== true) return null;
    var current = value.reason === 'same_run_manifest_not_available';
    if (current) {
      if (!validAnchor(value.anchor) || !validMonth(value.month, value.anchor) ||
          (value.graph.month !== value.month && JSON.stringify(value.graph.month) !== JSON.stringify(value.month)) ||
          value.anchor.originId.toLowerCase() !== value.originId.toLowerCase() ||
          value.month.localStart !== value.anchor.horizon.localStart || !DIGEST.test(value.digests.bundle || '') ||
          value.anchorSourceAuthenticated !== true || value.currentness.anchorCurrent !== true ||
          value.currentness.correctionOrRevocationApplied !== false) return null;
    } else if (value.anchor !== null || value.month !== null || value.graph.month !== null ||
        value.digests.bundle !== null || value.anchorSourceAuthenticated !== false ||
        value.currentness.anchorCurrent !== false || value.currentness.correctionOrRevocationApplied !== true) {
      return null;
    }
    return value;
  }

  function hash(character) { return character.repeat(64); }
  function demoBundle(organizationId) {
    var reason = 'same_run_manifest_not_available';
    var anchor = {
      originId: '90000000-0000-4000-8000-000000000010', timelineDigest: hash('2'),
      target: { key: 'demand.inbound_leads', definitionVersion: 'v1', sourceScope: 'retell_only_tenant_all' },
      unit: { key: 'count', currency: null },
      horizon: { localStart: '2026-11-01', startsAt: '2026-11-01T04:00:00.000000Z',
        endsAt: '2026-12-01T05:00:00.000000Z', grain: 'business_local_month', timeZone: 'America/New_York' },
      scope: { sourceScope: 'retell_only_tenant_all', serviceKey: null, areaKey: null, dimensionKeys: [] },
      profile: { businessProfileId: '10000000-0000-4000-8000-000000000001',
        businessProfileVersion: 1, businessProfileHash: hash('a'), timeZone: 'America/New_York' },
      sourceSnapshotDigest: hash('b'), sourceReceiptDigest: hash('c'), baselineDigest: hash('d'),
      configurationDigest: hash('e'), algorithm: { key: 'retell_three_complete_month_mean',
        version: 'm26-retell-three-month-mean-v2', definitionDigest: hash('f'),
        implementationDigest: hash('1'), buildIdentity: { kind: 'postgresql_function_definition_sha256',
          procedure: 'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)' } },
    };
    var month = { localStart: anchor.horizon.localStart, startsAt: anchor.horizon.startsAt,
      endsAt: anchor.horizon.endsAt, grain: 'business_local_month', timeZone: anchor.horizon.timeZone,
      calendarDigest: null, partialPeriod: null };
    var slots = SPECS.map(function (spec) { return { key: spec.key, label: spec.label,
      state: 'unavailable', reason: reason, target: { key: spec.targetKey,
        definitionVersion: spec.version, status: spec.status, componentTargets: spec.components.slice() },
      unit: { key: spec.unit, currency: null }, scope: { sourceScope: spec.scope,
        serviceKey: null, areaKey: null, dimensionKind: spec.dimension,
        dimensionValue: null, dimensionDigest: null }, manifestEntryState: 'unknown_manifest_unavailable',
      value: null, outputDigest: null, sourceSnapshotDigest: null, coverageDigest: null,
      currentnessDigest: null }; });
    var requirements = { sameRunManifest: { state: 'unavailable', reason: reason, complete: false,
      runId: null, revision: null, predictionCutoff: null, manifestDigest: null,
      presentTargetCount: null, expectedTargetCount: 6, absentTargets: null },
    earnedRevenueAuthority: { state: 'unavailable', reason: 'authorized_earned_revenue_not_available',
      recognitionPolicyVersion: null, recognitionPolicyDigest: null, completeEventTimeCoverage: false },
    operatingCostCoverage: { state: 'unavailable', reason: 'complete_operating_cost_categories_not_available',
      costBasisVersion: null, costBasisDigest: null, currency: null, categoriesComplete: false,
      nonOverlapping: false, longJobAllocationVerified: false },
    demandCoverage: { state: 'unavailable', reason: 'same_run_demand_target_not_available',
      eligibleChannelScope: null, distinctLeadIdentityComplete: false, rawRetellCallsSeparated: true },
    capacityScope: { state: 'unavailable', reason: 'same_run_role_capacity_target_not_available',
      roleKey: null, dimensionDigest: null, qualifiedAvailabilityComplete: false,
      commitmentOverlapReviewed: false } };
    return { version: VERSION, state: 'unavailable', reason: reason, organizationId: organizationId,
      originId: anchor.originId, checkedAt: '2026-10-08T12:00:00.000000Z', anchor: anchor, month: month,
      run: { state: 'unavailable', reason: reason, runId: null, revision: null,
        predictionCutoff: null, manifestDigest: null, algorithmSetDigest: null,
        configurationDigest: null, sourceSnapshotDigest: null, complete: false, current: false },
      slots: slots, requirements: requirements, graph: { state: 'unavailable', reason: reason,
        month: month, series: SPECS.map(function (spec) { return { key: spec.key, value: null,
          unitKey: spec.unit }; }) }, currentness: { anchorCurrent: true, manifestCurrent: false,
        sourceReadersCurrent: false, refreshRequired: true, correctionOrRevocationApplied: false },
      digests: { bundle: hash('3'), run: null, manifest: null }, anchorSourceAuthenticated: true,
      sameRunManifestComplete: false, bundleIssued: false, paidNumericServing: false,
      automaticActionAuthorized: false, researchOnly: true };
  }

  function create(options) {
    var document = options.document;
    var mode = options.mode;
    var fetcher = options.fetcher;
    var originProvider = options.originProvider;
    var generation = 0;
    function byId(id) { return document.getElementById(id); }
    function setText(id, text) { var node = byId(id); if (node) node.textContent = text; }
    function clear(message) {
      generation += 1;
      var root = byId('commandCenterMonthlyForecastKpis');
      if (root) root.setAttribute('aria-busy', 'false');
      setText('commandCenterMonthlyForecastKpisState', 'Unavailable');
      setText('commandCenterMonthlyForecastKpisExplanation', message || 'No monthly KPI bundle is shown.');
      SPECS.forEach(function (spec) {
        var suffix = spec.key.replace(/(^|_)(.)/g,
          function (_match, _prefix, character) { return character.toUpperCase(); });
        setText('commandCenterMonthlyForecastKpi' + suffix + 'Value', 'Not available');
        setText('commandCenterMonthlyForecastKpi' + suffix + 'State', 'Unavailable');
      });
      setText('commandCenterMonthlyForecastKpiGraphMonth', 'Month unavailable');
      setText('commandCenterMonthlyForecastKpiGraphPlot', 'No graph points are available.');
      setText('commandCenterMonthlyForecastKpisAuthority', 'No authenticated run identity is retained.');
      setText('commandCenterMonthlyForecastKpisBoundary',
        'Missing targets stay unavailable. They are never shown as zero or combined from different runs.');
      setText('commandCenterMonthlyForecastKpisStatus',
        'Monthly forecast KPIs unavailable. No card or graph value is shown.');
    }
    function render(value, authority) {
      var root = byId('commandCenterMonthlyForecastKpis');
      if (root) root.setAttribute('aria-busy', 'false');
      setText('commandCenterMonthlyForecastKpisState', authority.fictional ? 'Fictional guard' : 'KPIs unavailable');
      setText('commandCenterMonthlyForecastKpisExplanation', authority.fictional ?
        'This isolated fictional example shows the same guarded product state. It makes no paid forecast call and contains no fabricated KPI value.' :
        (value.reason === 'deterministic_baseline_not_current' ?
          'The authenticated source changed. Refresh its current origin before reviewing a monthly bundle.' :
          'The current source anchor exists, but one immutable six-target run manifest and required source authorities do not.'));
      value.slots.forEach(function (slot) {
        var suffix = slot.key.replace(/(^|_)(.)/g,
          function (_match, _prefix, character) { return character.toUpperCase(); });
        setText('commandCenterMonthlyForecastKpi' + suffix + 'Value', 'Not available');
        setText('commandCenterMonthlyForecastKpi' + suffix + 'State', 'Target absent from authenticated run');
      });
      setText('commandCenterMonthlyForecastKpiGraphMonth', value.month ?
        value.month.localStart + ' · ' + value.month.timeZone : 'Month unavailable');
      setText('commandCenterMonthlyForecastKpiGraphPlot',
        'Revenue, operating cost, profit, margin, demand and capacity points are withheld.');
      setText('commandCenterMonthlyForecastKpisAuthority', value.anchor ?
        'Tenant ' + authority.tenantId + ' / source anchor ' + value.anchor.sourceSnapshotDigest.slice(0, 12) +
          '… / monthly bundle ' + value.digests.bundle.slice(0, 12) +
          '… / run and manifest identities unavailable.' :
        'The prior source anchor was cleared because it is no longer current.');
      setText('commandCenterMonthlyForecastKpisBoundary',
        'Each target keeps its own definition, unit, scope and applicability. Profit and margin stay withheld when compatible revenue or cost evidence is missing.');
      setText('commandCenterMonthlyForecastKpisStatus',
        'Six monthly KPI cards and graph points remain unavailable under one guarded run boundary.');
    }
    function workspaceLoading() {
      clear('Checking one current monthly run boundary.');
      var root = byId('commandCenterMonthlyForecastKpis');
      if (root) root.setAttribute('aria-busy', 'true');
      setText('commandCenterMonthlyForecastKpisState', 'Loading');
    }
    function workspaceUnavailable() {
      clear('Refresh the Command Center before reviewing monthly forecast KPIs.');
      setText('commandCenterMonthlyForecastKpisState', 'Workspace unavailable');
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
        var fictional = demoBundle(authority.tenantId);
        if (!validateBundle(fictional)) { workspaceUnavailable(); return Promise.resolve(false); }
        render(fictional, authority); return Promise.resolve(true);
      }
      if (['owner','admin'].indexOf(authority.role) === -1) {
        clear('Your current role cannot view private monthly forecast KPIs.');
        return Promise.resolve(false);
      }
      var originId = originProvider && originProvider();
      if (!UUID.test(originId || '')) {
        clear('Choose a current authenticated demand origin before checking monthly KPI availability.');
        return Promise.resolve(false);
      }
      return fetcher('/api/v1/forecast/monthly-kpis/' + encodeURIComponent(originId), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (payload) {
          if (active !== generation || !response.ok || !payload || payload.success !== true) {
            throw new Error('unavailable');
          }
          var value = validateBundle(payload.data);
          if (!value || value.organizationId !== authority.tenantId) throw new Error('unavailable');
          render(value, authority); return true;
        });
      }).catch(function () {
        if (active === generation) clear('Monthly forecast KPIs could not load. Refresh to try again.');
        return false;
      });
    }
    clear();
    return Object.freeze({ workspaceLoading: workspaceLoading,
      workspaceUnavailable: workspaceUnavailable, workspaceReady: workspaceReady });
  }

  global.NorthStarMonthlyForecastKpis = Object.freeze({ VERSION: VERSION,
    validateBundle: validateBundle, demoBundle: demoBundle, create: create });
})(window);
