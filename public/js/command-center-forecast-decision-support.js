(function (global) {
  'use strict';

  var VERSION = 'm26-forecast-decision-support-v1';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var DIGEST = /^[0-9a-f]{64}$/;
  var INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
  var REASONS = ['same_run_manifest_not_available',
    'deterministic_baseline_not_current'];
  var TARGET_KEYS = ['revenue','operating_cost','profit','margin','demand','capacity'];
  var PREREQUISITES = ['accepted_immutable_run_and_revision',
    'versioned_current_alert_policy','authenticated_complete_source_currentness',
    'reviewed_materiality_and_uncertainty_basis',
    'authorized_advisory_receiving_workflow',
    'authorized_minimized_point_in_time_export'];
  var EXCLUDED = ['raw_transcripts','customer_contacts','worker_wages','secrets',
    'unrelated_records'];

  function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var own = Reflect.ownKeys(value);
    return own.length === keys.length && own.every(function (key) {
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === 'string' && keys.indexOf(key) !== -1 && descriptor &&
        descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value');
    });
  }

  function dense(value, expected) {
    if (!Array.isArray(value) || value.length !== expected.length ||
        Reflect.ownKeys(value).length !== expected.length + 1) return false;
    return value.every(function (item, index) {
      var descriptor = Object.getOwnPropertyDescriptor(value, index);
      return descriptor && descriptor.enumerable &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value') && item === expected[index];
    });
  }

  function copy(value) {
    return value === null ? null : JSON.parse(JSON.stringify(value));
  }

  function validInstant(value) {
    if (typeof value !== 'string' || !INSTANT.test(value)) return false;
    var milliseconds = Date.parse(value.slice(0, 23) + 'Z');
    return Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString().slice(0, 23) === value.slice(0, 23);
  }

  function fromDrilldowns(drilldowns, viewer, fictional) {
    var api = global.NorthStarForecastDrilldowns;
    if (!api || typeof api.validateDrilldowns !== 'function' ||
        !api.validateDrilldowns(drilldowns) || !viewer ||
        !UUID.test(viewer.userId || '') ||
        (fictional ? viewer.role !== 'viewer' :
          ['owner','admin'].indexOf(viewer.role) === -1)) return null;
    var stale = drilldowns.reason === 'deterministic_baseline_not_current';
    return { version: VERSION, state: 'unavailable', reason: drilldowns.reason,
      organizationId: drilldowns.organizationId, originId: drilldowns.originId,
      checkedAt: drilldowns.checkedAt, audience: {
        scope: fictional ? 'isolated_fictional_demo' : 'owner_admin',
        viewerUserId: viewer.userId, viewerRole: viewer.role },
      anchor: { period: copy(drilldowns.period), targetKeys: TARGET_KEYS.slice(),
        runId: null, runRevision: null, runOutputDigest: null,
        sourceSnapshotDigest: stale ? null :
          (drilldowns.bundle.anchor ? drilldowns.bundle.anchor.sourceSnapshotDigest : null),
        sourceReceiptDigest: stale ? null :
          (drilldowns.bundle.anchor ? drilldowns.bundle.anchor.sourceReceiptDigest : null),
        timelineDigest: drilldowns.digests.timeline,
        bundleDigest: drilldowns.digests.bundle, drilldownDigest: null },
      alert: { state: 'unavailable', reason: stale ? 'source_currentness_not_available' :
        'accepted_run_and_versioned_alert_policy_not_available', items: [], labelKind: null,
        headline: null, direction: null, baseline: null, threshold: null,
        materiality: null, uncertaintyBasis: null, evaluationBasis: null,
        explanation: null, ownerVisibleAt: null,
        policy: { id: null, version: null, digest: null, current: false },
        event: { id: null, digest: null },
        dedupe: { key: null, runId: null, policyDigest: null, eventDigest: null } },
      advice: { state: 'unavailable', reason: 'authenticated_current_alert_not_available',
        items: [], supportingEvidence: [], expectedTradeoff: null,
        missingInformation: PREREQUISITES.slice(), receivingWorkflow: null,
        advisoryOnly: true, navigationIsApproval: false, receiverRecheckRequired: true,
        handoffAuthorized: false, automaticActionAuthorized: false },
      export: { state: 'unavailable',
        reason: 'authorized_current_evidence_packet_not_available', packet: null,
        downloadUrl: null, shareUrl: null, pointInTime: true, fictional: fictional,
        retentionState: 'unknown', superseded: false, stale: stale,
        includedFields: [], excludedFields: EXCLUDED.slice() },
      prerequisites: PREREQUISITES.slice(), currentness: {
        anchorCurrent: drilldowns.currentness.anchorCurrent, acceptedRunCurrent: false,
        alertPolicyCurrent: false, exportAuthorityCurrent: false, refreshRequired: true,
        correctionOrRevocationApplied:
          drilldowns.currentness.correctionOrRevocationApplied },
      digests: { decisionSupport: null, run: null, alertPolicy: null,
        alertEvent: null, advice: null, exportPacket: null,
        timeline: drilldowns.digests.timeline, bundle: drilldowns.digests.bundle,
        drilldown: null }, alertIssued: false, recommendationIssued: false,
      exportIssued: false, zeroEvidenceAccepted: false,
      probabilityOrConfidenceIssued: false, automaticActionAuthorized: false,
      outboundCommunicationAuthorized: false, reviewedHandoffAuthorized: false,
      researchOnly: true };
  }

  function validPeriod(value) {
    return value === null || (exact(value, ['localStart','startsAt','endsAt','grain',
      'timeZone','calendarDigest','partialPeriod']) &&
      /^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(value.localStart || '') &&
      validInstant(value.startsAt) && validInstant(value.endsAt) &&
      value.startsAt < value.endsAt && value.grain === 'business_local_month' &&
      typeof value.timeZone === 'string' && value.timeZone.length > 0 &&
      value.timeZone.length <= 100 && value.calendarDigest === null &&
      value.partialPeriod === null);
  }

  function validAlert(value, stale) {
    return exact(value, ['state','reason','items','labelKind','headline','direction','baseline',
      'threshold','materiality','uncertaintyBasis','evaluationBasis','explanation',
      'ownerVisibleAt','policy','event','dedupe']) && value.state === 'unavailable' &&
      value.reason === (stale ? 'source_currentness_not_available' :
        'accepted_run_and_versioned_alert_policy_not_available') && dense(value.items, []) &&
      ['labelKind','headline','direction','baseline','threshold','materiality',
        'uncertaintyBasis','evaluationBasis','explanation','ownerVisibleAt']
        .every(function (key) { return value[key] === null; }) &&
      exact(value.policy, ['id','version','digest','current']) &&
      value.policy.id === null && value.policy.version === null &&
      value.policy.digest === null && value.policy.current === false &&
      exact(value.event, ['id','digest']) && value.event.id === null &&
      value.event.digest === null &&
      exact(value.dedupe, ['key','runId','policyDigest','eventDigest']) &&
      Object.keys(value.dedupe).every(function (key) { return value.dedupe[key] === null; });
  }

  function validAdvice(value) {
    return exact(value, ['state','reason','items','supportingEvidence','expectedTradeoff',
      'missingInformation','receivingWorkflow','advisoryOnly','navigationIsApproval',
      'receiverRecheckRequired','handoffAuthorized','automaticActionAuthorized']) &&
      value.state === 'unavailable' &&
      value.reason === 'authenticated_current_alert_not_available' &&
      dense(value.items, []) && dense(value.supportingEvidence, []) &&
      value.expectedTradeoff === null && dense(value.missingInformation, PREREQUISITES) &&
      value.receivingWorkflow === null && value.advisoryOnly === true &&
      value.navigationIsApproval === false && value.receiverRecheckRequired === true &&
      value.handoffAuthorized === false && value.automaticActionAuthorized === false;
  }

  function validExport(value, stale, fictional) {
    return exact(value, ['state','reason','packet','downloadUrl','shareUrl','pointInTime',
      'fictional','retentionState','superseded','stale','includedFields','excludedFields']) &&
      value.state === 'unavailable' &&
      value.reason === 'authorized_current_evidence_packet_not_available' &&
      value.packet === null && value.downloadUrl === null && value.shareUrl === null &&
      value.pointInTime === true && value.fictional === fictional &&
      value.retentionState === 'unknown' && value.superseded === false &&
      value.stale === stale && dense(value.includedFields, []) &&
      dense(value.excludedFields, EXCLUDED);
  }

  function validateDecisionSupport(value, options) {
    var fictional = Boolean(options && options.fictional);
    var keys = ['version','state','reason','organizationId','originId','checkedAt','audience',
      'anchor','alert','advice','export','prerequisites','currentness','digests','alertIssued',
      'recommendationIssued','exportIssued','zeroEvidenceAccepted',
      'probabilityOrConfidenceIssued','automaticActionAuthorized',
      'outboundCommunicationAuthorized','reviewedHandoffAuthorized','researchOnly'];
    if (!exact(value, keys) || value.version !== VERSION || value.state !== 'unavailable' ||
        REASONS.indexOf(value.reason) === -1 || !UUID.test(value.organizationId || '') ||
        !UUID.test(value.originId || '') || !validInstant(value.checkedAt) ||
        !exact(value.audience, ['scope','viewerUserId','viewerRole']) ||
        value.audience.scope !== (fictional ? 'isolated_fictional_demo' : 'owner_admin') ||
        !UUID.test(value.audience.viewerUserId || '') ||
        (fictional ? value.audience.viewerRole !== 'viewer' :
          ['owner','admin'].indexOf(value.audience.viewerRole) === -1)) return null;
    var stale = value.reason === 'deterministic_baseline_not_current';
    if (!exact(value.anchor, ['period','targetKeys','runId','runRevision','runOutputDigest',
      'sourceSnapshotDigest','sourceReceiptDigest','timelineDigest','bundleDigest',
      'drilldownDigest']) || !validPeriod(value.anchor.period) ||
        !dense(value.anchor.targetKeys, TARGET_KEYS) || value.anchor.runId !== null ||
        value.anchor.runRevision !== null || value.anchor.runOutputDigest !== null ||
        value.anchor.drilldownDigest !== null ||
        (stale && ['period','sourceSnapshotDigest','sourceReceiptDigest','timelineDigest',
          'bundleDigest'].some(function (key) { return value.anchor[key] !== null; })) ||
        (!stale && (!DIGEST.test(value.anchor.sourceSnapshotDigest || '') ||
          !DIGEST.test(value.anchor.sourceReceiptDigest || '') ||
          !DIGEST.test(value.anchor.timelineDigest || '') ||
          !DIGEST.test(value.anchor.bundleDigest || '')))) return null;
    if (!validAlert(value.alert, stale) || !validAdvice(value.advice) ||
        !validExport(value.export, stale, fictional) ||
        !dense(value.prerequisites, PREREQUISITES) ||
        !exact(value.currentness, ['anchorCurrent','acceptedRunCurrent','alertPolicyCurrent',
          'exportAuthorityCurrent','refreshRequired','correctionOrRevocationApplied']) ||
        value.currentness.anchorCurrent !== !stale ||
        value.currentness.acceptedRunCurrent !== false ||
        value.currentness.alertPolicyCurrent !== false ||
        value.currentness.exportAuthorityCurrent !== false ||
        value.currentness.refreshRequired !== true ||
        value.currentness.correctionOrRevocationApplied !== stale ||
        !exact(value.digests, ['decisionSupport','run','alertPolicy','alertEvent','advice',
          'exportPacket','timeline','bundle','drilldown']) ||
        ['decisionSupport','run','alertPolicy','alertEvent','advice','exportPacket','drilldown']
          .some(function (key) { return value.digests[key] !== null; }) ||
        value.digests.timeline !== value.anchor.timelineDigest ||
        value.digests.bundle !== value.anchor.bundleDigest ||
        value.alertIssued !== false || value.recommendationIssued !== false ||
        value.exportIssued !== false || value.zeroEvidenceAccepted !== false ||
        value.probabilityOrConfidenceIssued !== false ||
        value.automaticActionAuthorized !== false ||
        value.outboundCommunicationAuthorized !== false ||
        value.reviewedHandoffAuthorized !== false || value.researchOnly !== true) return null;
    return value;
  }

  function demoDecisionSupport(organizationId) {
    var api = global.NorthStarForecastDrilldowns;
    var drilldowns = api && typeof api.demoDrilldowns === 'function' ?
      api.demoDrilldowns(organizationId) : null;
    return fromDrilldowns(drilldowns,
      { userId: organizationId, role: 'viewer' }, true);
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
      var root = byId('commandCenterForecastDecisionSupport');
      if (root) root.setAttribute('aria-busy', 'false');
      var details = byId('commandCenterForecastDecisionDetails');
      if (details) details.open = false;
      setText('commandCenterForecastDecisionState', 'Unavailable');
      setText('commandCenterForecastDecisionExplanation', message ||
        'No alert, advisory next move or evidence packet is shown.');
      setText('commandCenterForecastAlertState', 'Unavailable');
      setText('commandCenterForecastAlertBody',
        'No alert issued. A current accepted run and versioned reviewed trigger policy are required.');
      setText('commandCenterForecastAdviceState', 'Unavailable');
      setText('commandCenterForecastAdviceBody',
        'No recommended next move issued. Navigation never approves or applies a change.');
      setText('commandCenterForecastExportState', 'Unavailable');
      setText('commandCenterForecastExportBody',
        'No point-in-time evidence packet issued. No download or share target is exposed.');
      var button = byId('commandCenterForecastExportButton');
      if (button) { button.disabled = true; button.setAttribute('aria-disabled', 'true'); }
      setText('commandCenterForecastDecisionAuthority',
        'No accepted run, alert policy, event, advisory, export packet or digest is retained.');
      setText('commandCenterForecastDecisionBoundary',
        'Unavailable is not zero. No probability, confidence percentage, recommendation, approval, communication or automatic action is inferred.');
      setText('commandCenterForecastDecisionStatus',
        'Forecast alerts, advice and export are unavailable. No action or evidence packet is available.');
    }
    function render(value, authority) {
      var root = byId('commandCenterForecastDecisionSupport');
      if (root) root.setAttribute('aria-busy', 'false');
      setText('commandCenterForecastDecisionState', authority.fictional ?
        'Fictional guard' : 'Actions unavailable');
      setText('commandCenterForecastDecisionExplanation', authority.fictional ?
        'This isolated fictional workspace uses the same guarded product state. It makes no paid forecast request and issues no alert, action or export.' :
        (value.reason === 'deterministic_baseline_not_current' ?
          'The source anchor changed, so every prior alert, advisory and export identity was cleared.' :
          'The current source anchor exists, but an accepted saved run, reviewed alert policy and authorized export packet do not.'));
      setText('commandCenterForecastAlertState', 'Not issued');
      setText('commandCenterForecastAlertBody',
        'No positive or negative alert is shown. Trigger direction, threshold, materiality, uncertainty and dedupe identity are unavailable.');
      setText('commandCenterForecastAdviceState', 'Not issued');
      setText('commandCenterForecastAdviceBody',
        'No advisory next move is shown. A receiving workflow must recheck current evidence before any separately authorized decision.');
      setText('commandCenterForecastExportState', 'Not issued');
      setText('commandCenterForecastExportBody', authority.fictional ?
        'No fictional packet is issued, and no paid evidence can enter this workspace.' :
        'No minimized point-in-time packet, download link or share link is available.');
      var button = byId('commandCenterForecastExportButton');
      if (button) { button.disabled = true; button.setAttribute('aria-disabled', 'true'); }
      setText('commandCenterForecastDecisionAuthority', value.anchor.period ?
        'Tenant ' + authority.tenantId + ' / month ' + value.anchor.period.localStart + ' ' +
          value.anchor.period.timeZone + ' / timeline ' +
          value.anchor.timelineDigest.slice(0, 12) + '. / bundle ' +
          value.anchor.bundleDigest.slice(0, 12) +
          '. / accepted run, alert policy, event, advisory and export digests unavailable.' :
        'Prior source, period and digest identities were cleared because they are not current.');
      setText('commandCenterForecastDecisionBoundary',
        'Advisory only. Navigation is not approval. Part 10D cannot change staff, equipment, schedules, estimates, prices, billing or messages, and cannot send communications.');
      setText('commandCenterForecastDecisionStatus', authority.fictional ?
        'Fictional forecast decision support remains guarded and value-free.' :
        'Forecast alerts, advice and export remain value-free and unavailable under the current evidence boundary.');
    }
    function workspaceLoading() {
      clear('Checking accepted-run, alert-policy, currentness and export authority.');
      var root = byId('commandCenterForecastDecisionSupport');
      if (root) root.setAttribute('aria-busy', 'true');
      setText('commandCenterForecastDecisionState', 'Loading');
    }
    function workspaceUnavailable() {
      clear('Refresh the Command Center before reviewing alerts, advice or evidence export.');
      setText('commandCenterForecastDecisionState', 'Workspace unavailable');
    }
    function workspaceReady(authority) {
      workspaceLoading();
      if (!authority || authority.mode !== mode || !UUID.test(authority.tenantId || '') ||
          typeof authority.role !== 'string' || !authority.role ||
          (mode === 'demo' && authority.role !== 'viewer') ||
          authority.fictional !== (mode === 'demo')) {
        workspaceUnavailable(); return Promise.resolve(false);
      }
      var active = generation;
      if (mode === 'demo') {
        var fictional = demoDecisionSupport(authority.tenantId);
        if (!validateDecisionSupport(fictional, { fictional: true })) {
          workspaceUnavailable(); return Promise.resolve(false);
        }
        render(fictional, authority); return Promise.resolve(true);
      }
      if (['owner','admin'].indexOf(authority.role) === -1) {
        clear('Your current role cannot view private forecast alerts, advice or exports.');
        return Promise.resolve(false);
      }
      var originId = originProvider && originProvider();
      if (!UUID.test(originId || '')) {
        clear('Choose a current authenticated demand origin before checking decision support.');
        return Promise.resolve(false);
      }
      return fetcher('/api/v1/forecast/decision-support/' + encodeURIComponent(originId), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json' },
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (payload) {
          if (active !== generation || !response.ok || !payload || payload.success !== true) {
            throw new Error('unavailable');
          }
          var value = validateDecisionSupport(payload.data, { fictional: false });
          if (!value || value.organizationId !== authority.tenantId) throw new Error('unavailable');
          render(value, authority); return true;
        });
      }).catch(function () {
        if (active === generation) clear(
          'Forecast alerts, advice and export could not load. Refresh to try again.');
        return false;
      });
    }
    clear();
    return Object.freeze({ workspaceLoading: workspaceLoading,
      workspaceUnavailable: workspaceUnavailable, workspaceReady: workspaceReady });
  }

  global.NorthStarForecastDecisionSupport = Object.freeze({ VERSION: VERSION,
    fromDrilldowns: fromDrilldowns, validateDecisionSupport: validateDecisionSupport,
    demoDecisionSupport: demoDecisionSupport, create: create });
})(window);
