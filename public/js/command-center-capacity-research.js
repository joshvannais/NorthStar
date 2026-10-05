(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorthStarCapacityResearch = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
  var ROLE = /^(owner|administrator|dispatcher|estimator|crew_lead|technician|accounting|employee|other)$/;
  var TARGETS = ['workload.accepted_person_hours.v1', 'workload.end_backlog_hours.v1',
    'capacity.available_role_hours.v1'];
  var DIMENSIONS = ['crew', 'skill', 'workingHours', 'location', 'travel', 'vehicle', 'equipment'];
  var CATEGORIES = ['bottleneck', 'backlog', 'overtime', 'contractor', 'hiring_need'];
  var EVIDENCE = ['authenticated_zero', 'bounded_value', 'unavailable'];
  var FORBIDDEN = /^(digest|expectedDigest|inputManifest|privateResults|privateManifest|metrics|payload|thresholds|personMinutes|demandMinutes|capacityMinutes|gapMinutes|workerId|jobId|assetId|memberId)$/i;
  var LABELS = {
    'workload.accepted_person_hours.v1': 'Accepted work demand',
    'workload.end_backlog_hours.v1': 'Work expected to remain',
    'capacity.available_role_hours.v1': 'Role capacity available',
    crew: 'Crew', skill: 'Skill', workingHours: 'Working hours', location: 'Location',
    travel: 'Travel', vehicle: 'Vehicle', equipment: 'Equipment',
    bottleneck: 'Bottleneck', backlog: 'Backlog pressure', overtime: 'Overtime pressure',
    contractor: 'Contractor attention', hiring_need: 'Hiring attention',
  };
  var DIMENSION_COPY = {
    crew: 'Whether a reviewed crew pool applies to this role and scope.',
    skill: 'Whether reviewed role and skill eligibility applies.',
    workingHours: 'Whether accepted working-time availability constrains the scope.',
    location: 'Whether the reviewed work location limits who can serve it.',
    travel: 'Whether accepted travel feasibility constrains the scope.',
    vehicle: 'Whether an accepted vehicle requirement applies.',
    equipment: 'Whether accepted equipment readiness applies.',
  };
  var CATEGORY_COPY = {
    bottleneck: 'Reviewed role demand may exceed constrained supply under the private policy.',
    backlog: 'Reviewed work may remain beyond the research horizon.',
    overtime: 'The private policy found an overtime attention condition.',
    contractor: 'The private policy found a contractor attention condition, without recommending engagement.',
    hiring_need: 'The reviewed qualitative history may need attention; this is never a hiring instruction.',
  };

  function exact(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === keys.length && keys.every(function (key) {
        return Object.prototype.hasOwnProperty.call(value, key);
      });
  }
  function instant(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
  function clean(value) {
    if (Array.isArray(value)) return value.every(clean);
    if (!value || typeof value !== 'object') return true;
    return Object.keys(value).every(function (key) { return !FORBIDDEN.test(key) && clean(value[key]); });
  }
  function common(value) {
    return value.researchOnly === true && value.forecastIssued === false &&
      value.paidNumericServing === false && value.forecastServingEnabled === false &&
      value.automaticActionTaken === false && typeof value.replayed === 'boolean';
  }
  function period(value) {
    return instant(value.predictionCutoffAt) && instant(value.horizonEndsAt) &&
      Date.parse(value.horizonEndsAt) - Date.parse(value.predictionCutoffAt) === 2592000000;
  }
  function workloadOrigin(value) {
    return exact(value, ['state', 'id', 'capacityRole', 'predictionCutoffAt', 'horizonEndsAt', 'targets',
      'refreshRequired', 'resultsWithheld', 'outputDigestsWithheld', 'researchOnly', 'forecastIssued',
      'paidNumericServing', 'forecastServingEnabled', 'automaticActionTaken', 'replayed']) &&
      ['workload_capacity_origin_current', 'workload_capacity_origin_stale'].includes(value.state) &&
      UUID.test(value.id || '') && ROLE.test(value.capacityRole || '') && period(value) &&
      Array.isArray(value.targets) && JSON.stringify(value.targets) === JSON.stringify(TARGETS) &&
      value.refreshRequired === value.state.endsWith('_stale') && value.resultsWithheld === true &&
      value.outputDigestsWithheld === true && common(value);
  }
  function workloadEvaluation(value) {
    return exact(value, ['state', 'id', 'originId', 'capacityRole', 'revision', 'evaluatedAt', 'targets',
      'refreshRequired', 'metricsWithheld', 'researchOnly', 'forecastIssued', 'paidNumericServing',
      'forecastServingEnabled', 'automaticActionTaken', 'replayed']) &&
      ['workload_capacity_evaluation_current', 'workload_capacity_evaluation_stale'].includes(value.state) &&
      UUID.test(value.id || '') && UUID.test(value.originId || '') && ROLE.test(value.capacityRole || '') &&
      Number.isSafeInteger(value.revision) && value.revision >= 1 && instant(value.evaluatedAt) &&
      JSON.stringify(value.targets) === JSON.stringify(TARGETS) &&
      value.refreshRequired === value.state.endsWith('_stale') && value.metricsWithheld === true && common(value);
  }
  function constrainedProjection(value, kind) {
    var timeKey = kind === 'origin' ? null : 'capturedAt';
    var keys = kind === 'origin'
      ? ['state', 'id', 'predictionCutoffAt', 'horizonEndsAt', 'scopeCount', 'refreshRequired',
        'allSevenDimensionsApplied', 'resultsWithheld', 'outputDigestsWithheld', 'researchOnly',
        'forecastIssued', 'paidNumericServing', 'forecastServingEnabled', 'automaticActionTaken', 'replayed']
      : kind === 'outcome'
        ? ['state', 'id', 'originId', 'revision', timeKey, 'refreshRequired', 'allSevenDimensionsApplied',
          'resultsWithheld', 'outputDigestsWithheld', 'researchOnly', 'forecastIssued', 'paidNumericServing',
          'forecastServingEnabled', 'automaticActionTaken', 'replayed']
        : ['state', 'id', 'originId', 'outcomeId', 'revision', timeKey, 'refreshRequired',
          'allSevenDimensionsApplied', 'metricsWithheld', 'researchOnly', 'forecastIssued',
          'paidNumericServing', 'forecastServingEnabled', 'automaticActionTaken', 'replayed'];
    if (!exact(value, keys) || !UUID.test(value.id || '') || value.allSevenDimensionsApplied !== true ||
        value.refreshRequired !== value.state.endsWith('_stale') || !common(value)) return false;
    if (kind === 'origin') return ['constrained_capacity_origin_current', 'constrained_capacity_origin_stale'].includes(value.state) &&
      period(value) && Number.isSafeInteger(value.scopeCount) && value.scopeCount >= 1 && value.scopeCount <= 20 &&
      value.resultsWithheld === true && value.outputDigestsWithheld === true;
    if (!UUID.test(value.originId || '') || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
        !instant(value.capturedAt)) return false;
    if (kind === 'outcome') return ['constrained_capacity_outcome_current', 'constrained_capacity_outcome_stale'].includes(value.state) &&
      value.resultsWithheld === true && value.outputDigestsWithheld === true;
    return ['constrained_capacity_evaluation_current', 'constrained_capacity_evaluation_stale'].includes(value.state) &&
      UUID.test(value.outcomeId || '') && value.metricsWithheld === true;
  }
  function categories(value) {
    var seen = {};
    return Array.isArray(value) && value.length >= 1 && value.length <= 20 && value.every(function (item) {
      var identity = item && item.alternativeKey + ':' + item.scopeKey + ':' + item.role;
      var valid = exact(item, ['alternativeKey', 'scopeKey', 'role', 'categories']) &&
        TOKEN.test(item.alternativeKey || '') && TOKEN.test(item.scopeKey || '') && ROLE.test(item.role || '') &&
        exact(item.categories, CATEGORIES) && CATEGORIES.every(function (name) {
          return exact(item.categories[name], ['state']) &&
            (name === 'hiring_need' ? ['clear', 'attention', 'insufficient_history'] : ['clear', 'attention'])
              .includes(item.categories[name].state);
        });
      if (!valid || seen[identity]) return false;
      seen[identity] = true; return true;
    });
  }
  function advisoryOrigin(value) {
    return exact(value, ['state', 'id', 'predictionCutoffAt', 'horizonEndsAt', 'scopeCount', 'categoryCount',
      'decisionAction', 'categories', 'refreshRequired', 'valuesWithheld', 'thresholdsWithheld',
      'outputDigestsWithheld', 'researchOnly', 'forecastIssued', 'paidNumericServing',
      'forecastServingEnabled', 'automaticActionTaken', 'replayed']) &&
      ['capacity_advisory_origin_current', 'capacity_advisory_origin_stale'].includes(value.state) &&
      UUID.test(value.id || '') && period(value) && Number.isSafeInteger(value.scopeCount) &&
      value.scopeCount >= 1 && value.scopeCount <= 20 && value.categoryCount === value.scopeCount * 5 &&
      [null, 'approve', 'reject', 'withdraw'].includes(value.decisionAction) &&
      (value.decisionAction === 'approve' ? categories(value.categories) : value.categories === null) &&
      value.refreshRequired === value.state.endsWith('_stale') && value.valuesWithheld === true &&
      value.thresholdsWithheld === true && value.outputDigestsWithheld === true && common(value);
  }
  function advisoryOutcome(value) {
    return exact(value, ['state', 'id', 'originId', 'revision', 'capturedAt', 'refreshRequired',
      'valuesWithheld', 'outputDigestsWithheld', 'researchOnly', 'forecastIssued', 'paidNumericServing',
      'forecastServingEnabled', 'automaticActionTaken', 'replayed']) &&
      ['capacity_advisory_outcome_current', 'capacity_advisory_outcome_stale'].includes(value.state) &&
      UUID.test(value.id || '') && UUID.test(value.originId || '') && Number.isSafeInteger(value.revision) &&
      value.revision >= 1 && instant(value.capturedAt) && value.refreshRequired === value.state.endsWith('_stale') &&
      value.valuesWithheld === true && value.outputDigestsWithheld === true && common(value);
  }
  function advisoryEvaluation(value) {
    return exact(value, ['state', 'id', 'originId', 'outcomeId', 'decisionId', 'revision', 'evaluatedAt',
      'refreshRequired', 'metricsWithheld', 'researchOnly', 'forecastIssued', 'paidNumericServing',
      'forecastServingEnabled', 'automaticActionTaken', 'replayed']) &&
      ['capacity_advisory_evaluation_current', 'capacity_advisory_evaluation_stale'].includes(value.state) &&
      ['id', 'originId', 'outcomeId', 'decisionId'].every(function (key) { return UUID.test(value[key] || ''); }) &&
      Number.isSafeInteger(value.revision) && value.revision >= 1 && instant(value.evaluatedAt) &&
      value.refreshRequired === value.state.endsWith('_stale') && value.metricsWithheld === true && common(value);
  }
  function continuation(value) {
    return exact(value, ['state', 'id', 'predecessorOriginId', 'periodStart', 'periodEnd', 'activationDeadline',
      'originId', 'refreshRequired', 'valuesWithheld', 'researchOnly', 'forecastIssued', 'paidNumericServing',
      'forecastServingEnabled', 'automaticActionTaken', 'replayed']) &&
      ['capacity_advisory_continuation_pending', 'capacity_advisory_continuation_activated',
        'capacity_advisory_continuation_missed', 'capacity_advisory_continuation_stale'].includes(value.state) &&
      UUID.test(value.id || '') && UUID.test(value.predecessorOriginId || '') && instant(value.periodStart) &&
      instant(value.periodEnd) && instant(value.activationDeadline) &&
      Date.parse(value.periodEnd) - Date.parse(value.periodStart) === 2592000000 &&
      Date.parse(value.activationDeadline) - Date.parse(value.periodStart) === 3600000 &&
      ((value.state === 'capacity_advisory_continuation_activated' && UUID.test(value.originId || '')) ||
        (value.state !== 'capacity_advisory_continuation_activated' && value.originId === null)) &&
      value.refreshRequired === ['capacity_advisory_continuation_missed', 'capacity_advisory_continuation_stale'].includes(value.state) &&
      value.valuesWithheld === true && common(value);
  }
  function history(value, kinds) {
    if (!exact(value, ['records', 'total', 'truncated']) || !Array.isArray(value.records) ||
        value.records.length > 40 || !Number.isSafeInteger(value.total) || value.total < value.records.length ||
        value.truncated !== (value.total > value.records.length)) return false;
    var ids = {};
    return value.records.every(function (item) {
      var valid = exact(item, ['kind', 'id', 'parentId', 'state', 'recordedAt', 'periodStart', 'periodEnd',
        'revision', 'action']) && kinds.includes(item.kind) && UUID.test(item.id || '') &&
        !ids[item.id] &&
        (item.parentId === null || UUID.test(item.parentId || '')) && instant(item.recordedAt) &&
        instant(item.periodStart) && instant(item.periodEnd) &&
        Date.parse(item.periodEnd) - Date.parse(item.periodStart) === 2592000000 &&
        (item.revision === null || (Number.isSafeInteger(item.revision) && item.revision >= 1)) &&
        (item.action === null || ['approve', 'reject', 'withdraw'].includes(item.action)) &&
        (['current', 'stale', 'capacity_advisory_continuation_pending',
          'capacity_advisory_continuation_activated', 'capacity_advisory_continuation_missed',
          'capacity_advisory_continuation_stale'].includes(item.state));
      if (!valid || (item.kind !== 'origin' && item.parentId === null) ||
          ((item.kind === 'decision') !== (item.action !== null))) return false;
      ids[item.id] = true; return true;
    });
  }
  function action(value, names) {
    return exact(value, ['name', 'originId', 'outcomeId', 'continuationId', 'correctionOriginId',
      'expectedDecisionId', 'expectedDecisionRevision']) && names.includes(value.name) &&
      ['originId', 'outcomeId', 'continuationId', 'correctionOriginId', 'expectedDecisionId']
        .every(function (key) { return value[key] === null || UUID.test(value[key] || ''); }) &&
      (value.expectedDecisionRevision === null ||
        (Number.isSafeInteger(value.expectedDecisionRevision) && value.expectedDecisionRevision >= 0));
  }
  function validateJourney(value) {
    if (!clean(value) || !exact(value, ['state', 'asOf', 'workload', 'constrained', 'advisory', 'boundaries',
      'researchOnly', 'forecastIssued', 'paidNumericServing', 'forecastServingEnabled', 'automaticActionTaken']) ||
      value.state !== 'capacity_research_journey_current' || !instant(value.asOf) ||
      value.researchOnly !== true || value.forecastIssued !== false || value.paidNumericServing !== false ||
      value.forecastServingEnabled !== false || value.automaticActionTaken !== false) return null;
    var w = value.workload;
    if (!exact(w, ['targets', 'selectedOrigin', 'selectedEvaluation', 'history', 'currentAction']) ||
      !Array.isArray(w.targets) || w.targets.length !== 3 || w.targets.some(function (item, index) {
        return !exact(item, ['key', 'evidenceState']) || item.key !== TARGETS[index] || !EVIDENCE.includes(item.evidenceState);
      }) || !(w.selectedOrigin === null || workloadOrigin(w.selectedOrigin)) ||
      !(w.selectedEvaluation === null || workloadEvaluation(w.selectedEvaluation)) ||
      !history(w.history, ['origin', 'evaluation']) || !action(w.currentAction,
        ['capture_origin', 'recover_origin', 'wait_for_horizon', 'capture_evaluation', 'complete'])) return null;
    if ((w.selectedOrigin === null) !== (w.currentAction.originId === null) ||
        (w.selectedOrigin && w.currentAction.originId !== w.selectedOrigin.id) ||
        (w.selectedEvaluation && (!w.selectedOrigin ||
          w.selectedEvaluation.originId !== w.selectedOrigin.id)) ||
        w.currentAction.outcomeId !== null || w.currentAction.continuationId !== null ||
        w.currentAction.correctionOriginId !== null || w.currentAction.expectedDecisionId !== null ||
        w.currentAction.expectedDecisionRevision !== null) return null;
    var workloadExpectedAction = !w.selectedOrigin ? 'capture_origin' :
      w.selectedOrigin.refreshRequired ? 'recover_origin' :
        Date.parse(value.asOf) < Date.parse(w.selectedOrigin.horizonEndsAt) ? 'wait_for_horizon' :
          !w.selectedEvaluation || w.selectedEvaluation.refreshRequired ? 'capture_evaluation' : 'complete';
    if (w.currentAction.name !== workloadExpectedAction) return null;
    var c = value.constrained;
    if (!exact(c, ['selectedOrigin', 'selectedOutcome', 'selectedEvaluation', 'scopes', 'history', 'currentAction']) ||
      !(c.selectedOrigin === null || constrainedProjection(c.selectedOrigin, 'origin')) ||
      !(c.selectedOutcome === null || constrainedProjection(c.selectedOutcome, 'outcome')) ||
      !(c.selectedEvaluation === null || constrainedProjection(c.selectedEvaluation, 'evaluation')) ||
      !Array.isArray(c.scopes) || c.scopes.length > 20 || c.scopes.some(function (item) {
        return !exact(item, ['alternativeKey', 'scopeKey', 'role', 'dimensions', 'evidenceState']) ||
          !TOKEN.test(item.alternativeKey || '') || !TOKEN.test(item.scopeKey || '') || !ROLE.test(item.role || '') ||
          !exact(item.dimensions, DIMENSIONS) || DIMENSIONS.some(function (key) {
            return typeof item.dimensions[key] !== 'boolean';
          }) || !EVIDENCE.includes(item.evidenceState);
      }) || !history(c.history, ['origin', 'outcome', 'evaluation']) || !action(c.currentAction,
        ['capture_origin', 'recover_origin', 'wait_for_horizon', 'capture_outcome', 'capture_evaluation', 'complete'])) return null;
    if ((c.selectedOrigin === null) !== (c.currentAction.originId === null) ||
        (c.selectedOrigin && c.currentAction.originId !== c.selectedOrigin.id) ||
        (c.selectedOutcome === null) !== (c.currentAction.outcomeId === null) ||
        (c.selectedOutcome && c.currentAction.outcomeId !== c.selectedOutcome.id) ||
        (c.selectedOutcome && (!c.selectedOrigin || c.selectedOutcome.originId !== c.selectedOrigin.id)) ||
        (c.selectedEvaluation && (!c.selectedOrigin ||
          c.selectedEvaluation.originId !== c.selectedOrigin.id)) ||
        (c.selectedOrigin && c.scopes.length !== c.selectedOrigin.scopeCount) ||
        c.currentAction.continuationId !== null || c.currentAction.correctionOriginId !== null ||
        c.currentAction.expectedDecisionId !== null || c.currentAction.expectedDecisionRevision !== null) return null;
    var constrainedExpectedAction = !c.selectedOrigin ? 'capture_origin' :
      c.selectedOrigin.refreshRequired ? 'recover_origin' :
        Date.parse(value.asOf) < Date.parse(c.selectedOrigin.horizonEndsAt) ? 'wait_for_horizon' :
          !c.selectedOutcome || c.selectedOutcome.refreshRequired ? 'capture_outcome' :
            !c.selectedEvaluation || c.selectedEvaluation.refreshRequired ? 'capture_evaluation' : 'complete';
    if (c.currentAction.name !== constrainedExpectedAction) return null;
    var a = value.advisory;
    if (!exact(a, ['selectedOrigin', 'selectedOutcome', 'selectedEvaluation', 'selectedContinuation',
      'preparationReady', 'history', 'currentAction']) || !(a.selectedOrigin === null || advisoryOrigin(a.selectedOrigin)) ||
      !(a.selectedOutcome === null || advisoryOutcome(a.selectedOutcome)) ||
      !(a.selectedEvaluation === null || advisoryEvaluation(a.selectedEvaluation)) ||
      !(a.selectedContinuation === null || continuation(a.selectedContinuation)) ||
      typeof a.preparationReady !== 'boolean' || !history(a.history,
        ['origin', 'decision', 'outcome', 'evaluation', 'continuation']) || !action(a.currentAction,
        ['capture_origin', 'recover_origin', 'review_advisory', 'reserve_continuation', 'wait_for_horizon',
          'prepare_outcome', 'capture_outcome', 'capture_evaluation', 'complete'])) return null;
    if ((a.selectedOrigin === null) !== (a.currentAction.originId === null) ||
        (a.selectedOrigin && a.currentAction.originId !== a.selectedOrigin.id) ||
        (a.selectedOutcome === null) !== (a.currentAction.outcomeId === null) ||
        (a.selectedOutcome && a.currentAction.outcomeId !== a.selectedOutcome.id) ||
        (a.selectedContinuation === null) !== (a.currentAction.continuationId === null) ||
        (a.selectedContinuation && a.currentAction.continuationId !== a.selectedContinuation.id) ||
        (a.selectedOutcome && (!a.selectedOrigin || a.selectedOutcome.originId !== a.selectedOrigin.id)) ||
        (a.selectedEvaluation && (!a.selectedOrigin ||
          a.selectedEvaluation.originId !== a.selectedOrigin.id)) ||
        (a.selectedContinuation && (!a.selectedOrigin ||
          a.selectedContinuation.predecessorOriginId !== a.selectedOrigin.id)) ||
        ((a.currentAction.expectedDecisionRevision === 0) !==
          (a.currentAction.expectedDecisionId === null))) return null;
    var advisoryExpectedAction = !a.selectedOrigin ? 'capture_origin' :
      a.selectedOrigin.refreshRequired ? 'recover_origin' :
        a.selectedOrigin.decisionAction !== 'approve' ? 'review_advisory' :
          Date.parse(value.asOf) < Date.parse(a.selectedOrigin.horizonEndsAt)
            ? (a.selectedContinuation ? 'wait_for_horizon' : 'reserve_continuation') :
            !a.preparationReady ? 'prepare_outcome' :
              !a.selectedOutcome || a.selectedOutcome.refreshRequired ? 'capture_outcome' :
                !a.selectedEvaluation || a.selectedEvaluation.refreshRequired ? 'capture_evaluation' : 'complete';
    if (a.currentAction.name !== advisoryExpectedAction ||
        a.currentAction.correctionOriginId !==
          (a.selectedOrigin && a.selectedOrigin.refreshRequired ? a.selectedOrigin.id : null)) return null;
    if (!exact(value.boundaries, ['sourceLineage', 'calculationBoundary', 'uncertainty',
      'alternativesCombined', 'valuesWithheld', 'predictionIsFact']) ||
      value.boundaries.sourceLineage !== 'accepted_installed_northstar_sources' ||
      value.boundaries.calculationBoundary !== 'qualitative_capacity_research_only' ||
      value.boundaries.uncertainty !== 'natural_history_accuracy_calibration_confidence_unavailable' ||
      value.boundaries.alternativesCombined !== false || value.boundaries.valuesWithheld !== true ||
      value.boundaries.predictionIsFact !== false) return null;
    return value;
  }

  var IDS = {
    wOld: '11111111-1111-4111-8111-111111111111', wNew: '11111111-1111-4111-8111-111111111112',
    wFinal: '11111111-1111-4111-8111-111111111113', wEval: '11111111-1111-4111-8111-111111111114',
    bOld: '22222222-2222-4222-8222-222222222221', bNew: '22222222-2222-4222-8222-222222222222',
    bFinal: '22222222-2222-4222-8222-222222222223', bOut: '22222222-2222-4222-8222-222222222224',
    bEval: '22222222-2222-4222-8222-222222222225', cOld: '33333333-3333-4333-8333-333333333331',
    cNew: '33333333-3333-4333-8333-333333333332', cFinal: '33333333-3333-4333-8333-333333333333',
    decision: '33333333-3333-4333-8333-333333333334', decision2: '33333333-3333-4333-8333-333333333335',
    decision3: '33333333-3333-4333-8333-333333333336', cont: '33333333-3333-4333-8333-333333333337',
    cont2: '33333333-3333-4333-8333-333333333338', cont3: '33333333-3333-4333-8333-333333333339',
    child: '33333333-3333-4333-8333-333333333340', cOut: '33333333-3333-4333-8333-333333333341',
    cEval: '33333333-3333-4333-8333-333333333342',
  };
  var P1 = ['2026-01-01T00:00:00.000Z', '2026-01-31T00:00:00.000Z'];
  var P2 = ['2026-02-01T00:00:00.000Z', '2026-03-03T00:00:00.000Z'];
  var P3 = ['2026-03-03T02:05:00.000Z', '2026-04-02T02:05:00.000Z'];
  var C1 = ['2026-01-31T00:00:00.000Z', '2026-03-02T00:00:00.000Z'];
  var C2 = ['2026-03-03T00:00:00.000Z', '2026-04-02T00:00:00.000Z'];
  var C3 = ['2026-04-02T02:05:00.000Z', '2026-05-02T02:05:00.000Z'];
  function baseFlags() { return { researchOnly: true, forecastIssued: false, paidNumericServing: false,
    forecastServingEnabled: false, automaticActionTaken: false, replayed: false }; }
  function merge(left, right) { return Object.assign({}, left, right); }
  function hist(kind, id, parent, state, when, range, revision, decision) {
    return { kind: kind, id: id, parentId: parent, state: state, recordedAt: when,
      periodStart: range[0], periodEnd: range[1], revision: revision, action: decision };
  }
  function demoJourney(stage) {
    stage = Number.isSafeInteger(stage) ? Math.max(0, Math.min(5, stage)) : 0;
    var absent = stage === 0; var stale = stage === 3; var recovered = stage >= 4; var final = stage === 5;
    var wId = final ? IDS.wFinal : recovered ? IDS.wNew : IDS.wOld;
    var bId = final ? IDS.bFinal : recovered ? IDS.bNew : IDS.bOld;
    var cId = final ? IDS.cFinal : recovered ? IDS.cNew : IDS.cOld;
    var range = final ? P3 : recovered ? P2 : P1;
    var wOrigin = absent ? null : merge({ state: stale ? 'workload_capacity_origin_stale' : 'workload_capacity_origin_current',
      id: wId, capacityRole: 'technician', predictionCutoffAt: range[0], horizonEndsAt: range[1],
      targets: TARGETS.slice(), refreshRequired: stale, resultsWithheld: true, outputDigestsWithheld: true }, baseFlags());
    var bOrigin = absent ? null : merge({ state: stale ? 'constrained_capacity_origin_stale' : 'constrained_capacity_origin_current',
      id: bId, predictionCutoffAt: range[0], horizonEndsAt: range[1], scopeCount: 2,
      refreshRequired: stale, allSevenDimensionsApplied: true, resultsWithheld: true,
      outputDigestsWithheld: true }, baseFlags());
    var scope = [
      { alternativeKey: 'existing_team', scopeKey: 'north_service', role: 'technician', dimensions:
        { crew: true, skill: true, workingHours: true, location: true, travel: true, vehicle: true, equipment: true },
        evidenceState: stale ? 'unavailable' : 'authenticated_zero' },
      { alternativeKey: 'flex_team', scopeKey: 'north_service', role: 'technician', dimensions:
        { crew: true, skill: true, workingHours: true, location: true, travel: true, vehicle: true, equipment: true },
        evidenceState: stale ? 'unavailable' : 'bounded_value' },
    ];
    var reviewed = stage >= 2 && !stale;
    var categoryRows = scope.map(function (item, index) {
      return { alternativeKey: item.alternativeKey, scopeKey: item.scopeKey, role: item.role, categories: {
        bottleneck: { state: index ? 'clear' : 'attention' }, backlog: { state: 'attention' },
        overtime: { state: index ? 'attention' : 'clear' }, contractor: { state: 'clear' },
        hiring_need: { state: stage >= 5 ? 'attention' : 'insufficient_history' },
      } };
    });
    var cOrigin = absent ? null : merge({ state: stale ? 'capacity_advisory_origin_stale' : 'capacity_advisory_origin_current',
      id: cId, predictionCutoffAt: range[0], horizonEndsAt: range[1], scopeCount: 2, categoryCount: 10,
      decisionAction: reviewed ? 'approve' : null, categories: reviewed ? categoryRows : null,
      refreshRequired: stale, valuesWithheld: true, thresholdsWithheld: true, outputDigestsWithheld: true }, baseFlags());
    var selectedContinuation = stage === 2 ? merge({ state: 'capacity_advisory_continuation_pending', id: IDS.cont,
      predecessorOriginId: cId, periodStart: C1[0], periodEnd: C1[1],
      activationDeadline: '2026-01-31T01:00:00.000Z', originId: null, refreshRequired: false,
      valuesWithheld: true }, baseFlags()) : stage === 3 ? merge({ state: 'capacity_advisory_continuation_stale',
      id: IDS.cont, predecessorOriginId: cId, periodStart: C1[0], periodEnd: C1[1],
      activationDeadline: '2026-01-31T01:00:00.000Z', originId: null, refreshRequired: true,
      valuesWithheld: true }, baseFlags()) : stage === 4 ? merge({ state: 'capacity_advisory_continuation_missed',
      id: IDS.cont2, predecessorOriginId: cId, periodStart: C2[0], periodEnd: C2[1],
      activationDeadline: '2026-03-03T01:00:00.000Z', originId: null, refreshRequired: true,
      valuesWithheld: true }, baseFlags()) : stage === 5 ? merge({ state: 'capacity_advisory_continuation_activated',
      id: IDS.cont3, predecessorOriginId: cId, periodStart: C3[0], periodEnd: C3[1],
      activationDeadline: '2026-04-02T03:05:00.000Z', originId: IDS.child, refreshRequired: false,
      valuesWithheld: true }, baseFlags()) : null;
    var wHistory = absent ? [] : [hist('origin', IDS.wOld, null, recovered ? 'stale' : (stale ? 'stale' : 'current'),
      '2026-01-01T00:05:00.000Z', P1, null, null)];
    var bHistory = absent ? [] : [hist('origin', IDS.bOld, null, recovered ? 'stale' : (stale ? 'stale' : 'current'),
      '2026-01-01T00:06:00.000Z', P1, null, null)];
    var cHistory = absent ? [] : [hist('origin', IDS.cOld, null, recovered ? 'stale' : (stale ? 'stale' : 'current'),
      '2026-01-01T00:07:00.000Z', P1, 1, null)];
    if (stage >= 2) cHistory.push(hist('decision', IDS.decision, IDS.cOld, recovered || stale ? 'stale' : 'current',
      '2026-01-01T00:08:00.000Z', P1, 1, 'approve'));
    if (stage >= 2) cHistory.push(hist('continuation', IDS.cont, IDS.cOld,
      stale || recovered ? 'capacity_advisory_continuation_stale' : 'capacity_advisory_continuation_pending',
      '2026-01-02T00:00:00.000Z', C1, null, null));
    if (recovered) {
      wHistory.push(hist('origin', IDS.wNew, null, final ? 'stale' : 'current', '2026-02-01T00:05:00.000Z', P2, null, null));
      bHistory.push(hist('origin', IDS.bNew, null, final ? 'stale' : 'current', '2026-02-01T00:06:00.000Z', P2, null, null));
      cHistory.push(hist('origin', IDS.cNew, IDS.cOld, final ? 'stale' : 'current', '2026-02-01T00:07:00.000Z', P2, 2, null));
      cHistory.push(hist('decision', IDS.decision2, IDS.cNew, final ? 'stale' : 'current', '2026-02-01T00:08:00.000Z', P2, 1, 'approve'));
      cHistory.push(hist('continuation', IDS.cont2, IDS.cNew, 'capacity_advisory_continuation_missed',
        '2026-02-02T00:00:00.000Z', C2, null, null));
    }
    if (final) {
      wHistory.push(hist('origin', IDS.wFinal, null, 'current', '2026-03-03T02:05:30.000Z', P3, null, null));
      bHistory.push(hist('origin', IDS.bFinal, null, 'current', '2026-03-03T02:06:00.000Z', P3, null, null));
      cHistory.push(hist('origin', IDS.cFinal, IDS.cNew, 'current', '2026-03-03T02:07:00.000Z', P3, 3, null));
      cHistory.push(hist('decision', IDS.decision3, IDS.cFinal, 'current', '2026-03-03T02:08:00.000Z', P3, 1, 'approve'));
      cHistory.push(hist('continuation', IDS.cont3, IDS.cFinal, 'capacity_advisory_continuation_activated',
        '2026-03-04T00:00:00.000Z', C3, null, null));
      wHistory.push(hist('evaluation', IDS.wEval, IDS.wFinal, 'current', '2026-04-02T02:10:00.000Z', P3, 1, null));
      bHistory.push(hist('outcome', IDS.bOut, IDS.bFinal, 'current', '2026-04-02T02:11:00.000Z', P3, 1, null));
      bHistory.push(hist('evaluation', IDS.bEval, IDS.bFinal, 'current', '2026-04-02T02:12:00.000Z', P3, 1, null));
      cHistory.push(hist('outcome', IDS.cOut, IDS.cFinal, 'current', '2026-04-02T02:13:00.000Z', P3, 1, null));
      cHistory.push(hist('evaluation', IDS.cEval, IDS.cFinal, 'current', '2026-04-02T02:14:00.000Z', P3, 1, null));
    }
    var wEval = final ? merge({ state: 'workload_capacity_evaluation_current', id: IDS.wEval,
      originId: IDS.wFinal, capacityRole: 'technician', revision: 1, evaluatedAt: '2026-04-02T02:10:00.000Z',
      targets: TARGETS.slice(), refreshRequired: false, metricsWithheld: true }, baseFlags()) : null;
    var bOut = final ? merge({ state: 'constrained_capacity_outcome_current', id: IDS.bOut,
      originId: IDS.bFinal, revision: 1, capturedAt: '2026-04-02T02:11:00.000Z', refreshRequired: false,
      allSevenDimensionsApplied: true, resultsWithheld: true, outputDigestsWithheld: true }, baseFlags()) : null;
    var bEval = final ? merge({ state: 'constrained_capacity_evaluation_current', id: IDS.bEval,
      originId: IDS.bFinal, outcomeId: IDS.bOut, revision: 1, capturedAt: '2026-04-02T02:12:00.000Z',
      refreshRequired: false, allSevenDimensionsApplied: true, metricsWithheld: true }, baseFlags()) : null;
    var cOut = final ? merge({ state: 'capacity_advisory_outcome_current', id: IDS.cOut,
      originId: IDS.cFinal, revision: 1, capturedAt: '2026-04-02T02:13:00.000Z', refreshRequired: false,
      valuesWithheld: true, outputDigestsWithheld: true }, baseFlags()) : null;
    var cEval = final ? merge({ state: 'capacity_advisory_evaluation_current', id: IDS.cEval,
      originId: IDS.cFinal, outcomeId: IDS.cOut, decisionId: IDS.decision3, revision: 1,
      evaluatedAt: '2026-04-02T02:14:00.000Z', refreshRequired: false, metricsWithheld: true }, baseFlags()) : null;
    return merge({ state: 'capacity_research_journey_current', asOf: final ? '2026-04-02T02:15:00.000Z' :
      stage === 4 ? '2026-03-03T02:00:00.000Z' : recovered ? '2026-02-02T00:10:00.000Z' : '2026-01-02T00:10:00.000Z',
      workload: { targets: TARGETS.map(function (key, index) { return { key: key,
        evidenceState: absent || stale ? 'unavailable' : index === 0 ? 'authenticated_zero' : 'bounded_value' }; }),
        selectedOrigin: wOrigin, selectedEvaluation: wEval,
        history: { records: wHistory, total: wHistory.length, truncated: false },
        currentAction: { name: absent ? 'capture_origin' : stale ? 'recover_origin' : final ? 'complete' :
          stage === 4 ? 'capture_evaluation' : 'wait_for_horizon',
          originId: wOrigin && wOrigin.id, outcomeId: null, continuationId: null, correctionOriginId: null,
          expectedDecisionId: null, expectedDecisionRevision: null } },
      constrained: { selectedOrigin: bOrigin, selectedOutcome: bOut, selectedEvaluation: bEval,
        scopes: absent ? [] : scope, history: { records: bHistory, total: bHistory.length, truncated: false },
        currentAction: { name: absent ? 'capture_origin' : stale ? 'recover_origin' : final ? 'complete' :
          stage === 4 ? 'capture_outcome' : 'wait_for_horizon',
          originId: bOrigin && bOrigin.id, outcomeId: bOut && bOut.id, continuationId: null,
          correctionOriginId: null, expectedDecisionId: null, expectedDecisionRevision: null } },
      advisory: { selectedOrigin: cOrigin, selectedOutcome: cOut, selectedEvaluation: cEval,
        selectedContinuation: selectedContinuation, preparationReady: stage === 5,
        history: { records: cHistory, total: cHistory.length, truncated: false },
        currentAction: { name: absent ? 'capture_origin' : stale ? 'recover_origin' : stage === 1 ? 'review_advisory' :
          stage === 2 ? 'wait_for_horizon' : stage === 4 ? 'prepare_outcome' : 'complete', originId: cOrigin && cOrigin.id,
          outcomeId: cOut && cOut.id, continuationId: selectedContinuation && selectedContinuation.id,
          correctionOriginId: stale ? cId : null, expectedDecisionId: stage >= 2 && !stale ?
            (final ? IDS.decision3 : recovered ? IDS.decision2 : IDS.decision) : null,
          expectedDecisionRevision: stage >= 2 && !stale ? 1 : 0 } },
      boundaries: { sourceLineage: 'accepted_installed_northstar_sources',
        calculationBoundary: 'qualitative_capacity_research_only',
        uncertainty: 'natural_history_accuracy_calibration_confidence_unavailable',
        alternativesCombined: false, valuesWithheld: true, predictionIsFact: false },
      researchOnly: true, forecastIssued: false, paidNumericServing: false,
      forecastServingEnabled: false, automaticActionTaken: false }, {});
  }

  function create(options) {
    options = options || {};
    var doc = options.document;
    var mode = options.mode;
    var fetcher = options.fetcher;
    var identity = null; var identityRevision = 0; var loadedIdentity = null;
    var journey = null; var busy = false; var uncertainAttempt = null; var demoStage = 0;
    var stateOverride = null;
    function byId(id) { return doc.getElementById(id); }
    function node(tag, className, text) {
      var value = doc.createElement(tag); if (className) value.className = className;
      if (text !== undefined) value.textContent = text; return value;
    }
    function evidenceLabel(value) {
      return value === 'authenticated_zero' ? 'Authenticated zero' :
        value === 'bounded_value' ? 'Reviewed value withheld' : 'Unavailable';
    }
    function title(value) { return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, function (x) { return x.toUpperCase(); }); }
    function date(value) {
      try { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
      catch (_error) { return 'time unavailable'; }
    }
    function setOverall(label, state, message) {
      var pill = byId('commandCenterCapacityState'); pill.textContent = label; pill.dataset.state = state;
      byId('commandCenterCapacityNotice').textContent = message;
    }
    function laneState(projection, laneHistory) {
      if (!projection) return { label: 'Unavailable', state: 'unavailable' };
      if (projection.state.endsWith('_stale')) return { label: 'Stale · recover', state: 'stale' };
      if (laneHistory.records.some(function (item) { return item.kind === 'origin' && item.state === 'stale'; }))
        return { label: 'Recovered · current', state: 'current' };
      return { label: 'Current', state: 'current' };
    }
    function renderDimensions(scopes) {
      var list = byId('commandCenterCapacityDimensions'); list.replaceChildren();
      DIMENSIONS.forEach(function (key) {
        var box = node('div'); var applied = scopes.length && scopes.some(function (scope) { return scope.dimensions[key]; });
        box.append(node('dt', '', LABELS[key]), node('dd', '', DIMENSION_COPY[key] +
          (scopes.length ? (applied ? ' Applied in at least one selected scope.' : ' Not applicable in the selected scopes.') : ' Evidence unavailable.')));
        list.append(box);
      });
    }
    function renderAlternatives(scopes) {
      var root = byId('commandCenterCapacityAlternatives'); root.replaceChildren();
      var groups = {};
      scopes.forEach(function (scope) { (groups[scope.alternativeKey] = groups[scope.alternativeKey] || []).push(scope); });
      Object.keys(groups).forEach(function (key) {
        var section = node('section', 'command-center-capacity-alternative');
        section.append(node('h4', '', title(key)), node('p', '', 'One alternative plan. Keep it separate from every other alternative.'));
        groups[key].forEach(function (scope) {
          var row = node('div', 'command-center-capacity-alternative-scope');
          row.append(node('strong', '', title(scope.scopeKey) + ' · ' + title(scope.role)),
            node('span', '', evidenceLabel(scope.evidenceState)));
          section.append(row);
        }); root.append(section);
      });
      if (!scopes.length) root.append(node('p', '', 'No current constrained-capacity scope is available.'));
    }
    function renderCategories(origin) {
      var list = byId('commandCenterCapacityCategories'); list.replaceChildren();
      CATEGORIES.forEach(function (key) {
        var states = origin && origin.decisionAction === 'approve' ? origin.categories.map(function (row) {
          return row.categories[key].state;
        }) : [];
        var label = !states.length ? 'Withheld pending human approval' : states.includes('attention') ? 'Attention' :
          states.includes('insufficient_history') ? 'Insufficient history' : 'Clear under private policy';
        var box = node('div'); box.append(node('dt', '', LABELS[key]), node('dd', '', CATEGORY_COPY[key] + ' ' + label + '.'));
        list.append(box);
      });
    }
    function renderHistory() {
      var root = byId('commandCenterCapacityHistory'); root.replaceChildren();
      if (!journey) { root.append(node('p', '', 'No receipt history is available.')); return; }
      [['Workload', journey.workload.history], ['Constraints', journey.constrained.history],
        ['Advisories', journey.advisory.history]].forEach(function (entry) {
        var section = node('section'); section.append(node('h4', '', entry[0])); var list = node('ol');
        entry[1].records.forEach(function (record) {
          list.append(node('li', '', title(record.kind) + ' · ' + title(record.state) + ' · ' + record.id +
            (record.parentId ? ' · predecessor ' + record.parentId : '') + ' · ' + date(record.recordedAt) +
            (record.action ? ' · ' + record.action : '')));
        });
        if (!entry[1].records.length) list.append(node('li', '', 'No saved receipt.'));
        section.append(list); if (entry[1].truncated) section.append(node('p', '', 'Earlier immutable receipts remain stored but are not loaded in this bounded view.'));
        root.append(section);
      });
    }
    function actionLabel(name) {
      return ({ capture_origin: 'Save current research origin', recover_origin: 'Append recovery origin',
        wait_for_horizon: 'Waiting for the research horizon', capture_outcome: 'Save observed outcome',
        capture_evaluation: 'Save evaluation receipt', review_advisory: 'Choose a human review decision',
        reserve_continuation: 'Save successor research continuation', prepare_outcome: 'Prepare exact outcome evidence',
        complete: 'Research lifecycle complete' })[name] || 'Unavailable';
    }
    function reasonReady() { return byId('commandCenterCapacityReason').value.trim().length >= 10; }
    function updateButtons() {
      doc.querySelectorAll('[data-capacity-lane]').forEach(function (button) {
        var lane = button.dataset.capacityLane; var selected = journey && journey[lane];
        var current = selected && selected.currentAction; button.textContent = current ? actionLabel(current.name) : 'Research unavailable';
        var needsReason = current && ['capture_origin', 'recover_origin', 'reserve_continuation'].includes(current.name);
        button.disabled = mode === 'demo' || busy || !current || ['wait_for_horizon', 'complete', 'review_advisory'].includes(current.name) ||
          (needsReason && !reasonReady());
      });
      var advisory = journey && journey.advisory; var canReview = mode !== 'demo' && !busy && reasonReady() &&
        advisory && advisory.selectedOrigin && advisory.selectedOrigin.state === 'capacity_advisory_origin_current';
      doc.querySelectorAll('[data-capacity-decision]').forEach(function (button) { button.disabled = !canReview; });
      byId('commandCenterCapacityRefresh').disabled = mode === 'demo' || busy || !identity;
      byId('commandCenterCapacityRetry').hidden = !uncertainAttempt || mode === 'demo';
      byId('commandCenterCapacityRetry').disabled = busy;
    }
    function render() {
      byId('commandCenterCapacityPaidControls').hidden = mode === 'demo';
      byId('commandCenterCapacityDemoControls').hidden = mode !== 'demo';
      byId('commandCenterCapacityAsOf').textContent = journey ? date(journey.asOf) : 'Unavailable';
      if (!journey) {
        var labels = ['Workload', 'Constraint', 'Advisory'];
        ['commandCenterCapacityWorkloadState', 'commandCenterCapacityConstraintState', 'commandCenterCapacityAdvisoryState']
          .forEach(function (id, index) { var item = byId(id); item.textContent = labels[index] + ' unavailable'; item.dataset.state = 'unavailable'; });
        byId('commandCenterCapacityTargets').replaceChildren(node('li', '', 'No current workload evidence.'));
        renderDimensions([]); renderAlternatives([]); renderCategories(null);
        byId('commandCenterCapacityContinuation').textContent = 'No continuation receipt is selected.';
        renderHistory(); updateButtons(); return;
      }
      var ws = laneState(journey.workload.selectedOrigin, journey.workload.history);
      var cs = laneState(journey.constrained.selectedOrigin, journey.constrained.history);
      var as = laneState(journey.advisory.selectedOrigin, journey.advisory.history);
      [[byId('commandCenterCapacityWorkloadState'), ws], [byId('commandCenterCapacityConstraintState'), cs],
        [byId('commandCenterCapacityAdvisoryState'), as]].forEach(function (entry) {
          entry[0].textContent = entry[1].label; entry[0].dataset.state = entry[1].state;
        });
      var targets = byId('commandCenterCapacityTargets'); targets.replaceChildren();
      journey.workload.targets.forEach(function (target) {
        var row = node('li'); row.append(node('strong', '', LABELS[target.key]), node('span', '', evidenceLabel(target.evidenceState))); targets.append(row);
      });
      renderDimensions(journey.constrained.scopes); renderAlternatives(journey.constrained.scopes);
      renderCategories(journey.advisory.selectedOrigin);
      var cont = journey.advisory.selectedContinuation;
      byId('commandCenterCapacityContinuation').textContent = cont ?
        ({ capacity_advisory_continuation_pending: 'Continuation pending: it may activate only at its fixed boundary after every source recheck.',
          capacity_advisory_continuation_activated: 'Continuation activated from its exact predecessor; the child remains research-only.',
          capacity_advisory_continuation_missed: 'Continuation missed its fixed deadline. It is unavailable evidence and cannot be moved or revived.',
          capacity_advisory_continuation_stale: 'Continuation is stale or superseded. Restored bytes do not revive it; recovery requires a new receipt.' })[cont.state] :
        'No continuation receipt is selected. Pending, activated, missed and stale states remain distinct.';
      renderHistory(); updateButtons();
      if (!stateOverride) {
        var laneStates = [ws, cs, as];
        var unavailable = laneStates.every(function (item) { return item.state === 'unavailable'; });
        var stale = laneStates.some(function (item) { return item.state === 'stale'; });
        var recovered = laneStates.some(function (item) { return item.label.startsWith('Recovered'); });
        if (unavailable) setOverall('Unavailable', 'unavailable',
          'No current safe capacity research receipt is available. An authenticated zero would be shown separately.');
        else if (stale) setOverall('Stale · refresh required', 'stale',
          'Accepted source evidence changed. Older receipts remain immutable and no stale current claim is shown.');
        else setOverall(recovered ? 'Recovered · current' : 'Current research', recovered ? 'recovered' : 'current',
          recovered ? 'Recovery appended new current receipts. Superseded evidence remains immutable and is not revived.' :
            'Currentness was checked after the complete accepted source fence. Values, thresholds and private calculations remain withheld.');
      }
    }
    function clearWith(label, state, message) {
      journey = null; stateOverride = state; setOverall(label, state, message); render();
    }
    function classify(status) {
      if (status === 403) return ['Restricted', 'restricted', 'This paid research journey is limited to a current owner or administrator session.'];
      if (status === 404) return ['Unavailable', 'unavailable', 'No matching tenant-private research evidence is available.'];
      if (status === 409) return ['Conflict', 'conflict', 'The exact source or predecessor changed. Refresh before starting a new action.'];
      if (status >= 500) return ['Uncertain', 'uncertain', 'The result is uncertain. Retry only the exact endpoint, body and idempotency key shown by this action.'];
      return ['Failed', 'failed', 'The action was refused without a partial receipt. Review the current state before trying a new action.'];
    }
    function validateMutation(value, expectedAction) {
      return exact(value, ['state', 'action', 'receiptId', 'originId', 'outcomeId', 'continuationId', 'revision',
        'researchOnly', 'automaticActionTaken', 'replayed']) && value.state === 'capacity_research_action_recorded' &&
        value.action === expectedAction && ['receiptId', 'originId', 'outcomeId', 'continuationId'].every(function (key) {
          return value[key] === null || UUID.test(value[key] || '');
        }) && (value.revision === null || (Number.isSafeInteger(value.revision) && value.revision >= 1)) &&
        value.researchOnly === true && value.automaticActionTaken === false && typeof value.replayed === 'boolean';
    }
    function validateDecision(value, expectedAction) {
      return exact(value, ['state', 'id', 'originId', 'action', 'revision', 'researchOnly',
        'automaticActionTaken', 'replayed']) && value.state === 'capacity_advisory_decision_recorded' &&
        UUID.test(value.id || '') && UUID.test(value.originId || '') && value.action === expectedAction &&
        Number.isSafeInteger(value.revision) && value.revision >= 1 && value.researchOnly === true &&
        value.automaticActionTaken === false && typeof value.replayed === 'boolean';
    }
    function load(force) {
      if (mode === 'demo') { journey = validateJourney(demoJourney(demoStage)); stateOverride = null; render(); return Promise.resolve(journey); }
      if (!identity || busy || (!force && loadedIdentity === identity)) return Promise.resolve(journey);
      var expectedIdentity = identity; var expectedRevision = identityRevision; busy = true; stateOverride = 'loading';
      clearWith('Loading', 'loading', 'Rechecking paid access, source lineage and currentness. No forecast mutation is performed.');
      return fetcher('/api/v1/forecast/capacity-advice/journey/current', {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (payload) {
          if (expectedIdentity !== identity || expectedRevision !== identityRevision) return null;
          if (!response.ok || !payload || payload.success !== true) {
            var failure = classify(response.status); clearWith(failure[0], failure[1], failure[2]); return null;
          }
          var validated = validateJourney(payload.data); if (!validated) { clearWith('Failed', 'failed', 'The server returned an unsafe or incomplete projection. No current claim is shown.'); return null; }
          journey = validated; loadedIdentity = identity; stateOverride = null; render(); return journey;
        });
      }).catch(function () {
        if (expectedIdentity === identity && expectedRevision === identityRevision)
          clearWith('Failed', 'failed', 'Capacity research could not be refreshed. No stale current claim is shown.');
        return null;
      }).finally(function () { if (expectedIdentity === identity && expectedRevision === identityRevision) { busy = false; updateButtons(); } });
    }
    function sendAttempt(attempt) {
      if (!attempt || busy || mode === 'demo') return Promise.resolve(null);
      var expectedIdentity = identity; var expectedRevision = identityRevision; busy = true; updateButtons();
      return fetcher(attempt.url, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key },
        body: attempt.bodyText }).then(function (response) {
          return response.json().catch(function () { return null; }).then(function (payload) {
            if (expectedIdentity !== identity || expectedRevision !== identityRevision) return null;
            if (!response.ok || !payload || payload.success !== true) {
              var failure = classify(response.status);
              uncertainAttempt = response.status >= 500 ? attempt : null;
              clearWith(failure[0], failure[1], failure[2]); return null;
            }
            var value = payload.data; var valid = attempt.kind === 'decision'
              ? validateDecision(value, attempt.expectedAction) : validateMutation(value, attempt.expectedAction);
            if (!valid) { uncertainAttempt = null; clearWith('Failed', 'failed', 'The response did not match the exact safe action schema. No current claim is shown.'); return null; }
            uncertainAttempt = null; loadedIdentity = null; stateOverride = null; return value;
          });
        }).then(function (value) {
          if (value && expectedIdentity === identity && expectedRevision === identityRevision) {
            busy = false; return load(true);
          }
          return value;
        }).catch(function () {
          if (expectedIdentity === identity && expectedRevision === identityRevision) {
            uncertainAttempt = attempt;
            clearWith('Uncertain', 'uncertain', 'The connection ended before the result was known. Retry reuses the exact endpoint, body and idempotency key.');
          }
          return null;
        }).finally(function () { if (expectedIdentity === identity && expectedRevision === identityRevision) { busy = false; updateButtons(); } });
    }
    function key() {
      var value = typeof options.idempotency === 'function' ? options.idempotency() : null;
      return typeof value === 'string' && value.length >= 16 ? value : 'capacity-ui-' + String(Date.now()) + '-fixed';
    }
    function laneAttempt(lane) {
      var current = journey && journey[lane] && journey[lane].currentAction; if (!current) return null;
      var map = lane === 'workload' ? { capture_origin: 'workload_capture_origin', recover_origin: 'workload_capture_origin',
        capture_evaluation: 'workload_capture_evaluation' } : lane === 'constrained' ?
        { capture_origin: 'constrained_capture_origin', recover_origin: 'constrained_capture_origin',
          capture_outcome: 'constrained_capture_outcome', capture_evaluation: 'constrained_capture_evaluation' } :
        { capture_origin: 'advisory_capture_origin', recover_origin: 'advisory_capture_origin',
          reserve_continuation: 'advisory_reserve_continuation', prepare_outcome: 'advisory_prepare_outcome',
          capture_outcome: 'advisory_capture_outcome', capture_evaluation: 'advisory_capture_evaluation' };
      var actionName = map[current.name]; if (!actionName) return null;
      var needsReason = ['workload_capture_origin', 'constrained_capture_origin', 'advisory_capture_origin',
        'advisory_reserve_continuation'].includes(actionName);
      var body = { action: actionName, originId: current.originId, outcomeId: current.outcomeId,
        correctionOriginId: actionName === 'advisory_capture_origin' ? current.correctionOriginId : null,
        reason: needsReason ? byId('commandCenterCapacityReason').value.trim() : null,
        confirmed: true, confirmationVersion: 'm26-capacity-ui-action-v1' };
      if (['workload_capture_origin', 'constrained_capture_origin', 'advisory_capture_origin'].includes(actionName)) body.originId = null;
      if (!['constrained_capture_evaluation', 'advisory_capture_evaluation'].includes(actionName)) body.outcomeId = null;
      return { kind: 'action', url: '/api/v1/forecast/capacity-advice/journey/actions', key: key(),
        bodyText: JSON.stringify(body), expectedAction: actionName, identity: identity };
    }
    function decisionAttempt(decision) {
      var current = journey && journey.advisory.currentAction; if (!current || !current.originId) return null;
      var body = { action: decision, expectedDecisionId: current.expectedDecisionId,
        expectedDecisionRevision: current.expectedDecisionRevision, reason: byId('commandCenterCapacityReason').value.trim(),
        confirmed: true, confirmationVersion: 'm26-capacity-ui-decision-v1' };
      return { kind: 'decision', url: '/api/v1/forecast/capacity-advice/origins/' + encodeURIComponent(current.originId) + '/safe-decisions',
        key: key(), bodyText: JSON.stringify(body), expectedAction: decision, identity: identity };
    }
    byId('commandCenterCapacityReason').addEventListener('input', updateButtons);
    byId('commandCenterCapacityRefresh').addEventListener('click', function () { loadedIdentity = null; return load(true); });
    byId('commandCenterCapacityRetry').addEventListener('click', function () {
      if (uncertainAttempt && uncertainAttempt.identity === identity) return sendAttempt(uncertainAttempt);
      return null;
    });
    doc.querySelectorAll('[data-capacity-lane]').forEach(function (button) {
      button.addEventListener('click', function () {
        var attempt = laneAttempt(button.dataset.capacityLane); return attempt ? sendAttempt(attempt) : null;
      });
    });
    doc.querySelectorAll('[data-capacity-decision]').forEach(function (button) {
      button.addEventListener('click', function () {
        var attempt = decisionAttempt(button.dataset.capacityDecision); return attempt ? sendAttempt(attempt) : null;
      });
    });
    doc.querySelectorAll('[data-capacity-demo-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (mode !== 'demo') return;
        if (button.dataset.capacityDemoAction === 'reset') demoStage = 0;
        else if (button.dataset.capacityDemoAction === 'stale') demoStage = 3;
        else if (button.dataset.capacityDemoAction === 'recover') demoStage = 4;
        else demoStage = Math.min(5, demoStage + 1);
        journey = validateJourney(demoJourney(demoStage)); stateOverride = null; render();
      });
    });
    renderDimensions([]); renderCategories(null); render();
    return {
      workspaceReady: function (nextIdentity) {
        if (typeof nextIdentity !== 'string' || !nextIdentity || nextIdentity.length > 4096) return this.workspaceUnavailable();
        if (identity !== nextIdentity) {
          identity = nextIdentity; identityRevision += 1; loadedIdentity = null; journey = null;
          uncertainAttempt = null; demoStage = 0; busy = false; stateOverride = null;
        }
        return load(false);
      },
      workspaceUnavailable: function () {
        identity = null; identityRevision += 1; loadedIdentity = null; uncertainAttempt = null;
        busy = false; stateOverride = 'unavailable'; clearWith('Workspace unavailable', 'unavailable',
          'Workspace mode, tenant, session or generation is unavailable. Saved tokens and uncertain retries were cleared.');
        return null;
      },
      refresh: function () { loadedIdentity = null; return load(true); },
      inspect: function () { return { identity: identity, journey: journey, uncertainAttempt: uncertainAttempt,
        demoStage: demoStage, busy: busy }; },
    };
  }

  return { create: create, validateJourney: validateJourney, demoJourney: demoJourney,
    targets: TARGETS.slice(), dimensions: DIMENSIONS.slice(), categories: CATEGORIES.slice() };
});
