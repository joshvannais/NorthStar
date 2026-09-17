(function (global) {
  'use strict';

  var contract = global.NorthStarLearningCenterContract;
  var session = global.NorthStarAccountSession;
  var demo = global.location.pathname.indexOf('/demo/') === 0;
  if (global.history && 'scrollRestoration' in global.history) global.history.scrollRestoration = 'manual';
  var state = { center: null, sourceKind: null, sourceKey: null, detail: null, consents: {}, matches: null, calibration: null, health: null, healthReference: null, operations: null, loadGeneration: 0, selectionGeneration: 0, calibrationGeneration: 0, healthGeneration: 0 };
  var el = function (id) { return document.getElementById(id); };

  function node(tag, className, text) {
    var value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  function clear(target) { while (target.firstChild) target.removeChild(target.firstChild); }
  function status(message, tone) { el('learningStatus').textContent = message; el('learningStatus').dataset.tone = tone || ''; }
  function integer(value) { return Number.isSafeInteger(value) ? value : 0; }
  function currentPair(consent) {
    return consent && consent.current ? { revision: consent.current.revision, digest: consent.current.digest } : { revision: 0, digest: 'none' };
  }
  function idempotency() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'learning-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }
  function api(path, options) {
    return session.json('/api/v1/learning' + path, options || { method: 'GET', cache: 'no-store' }).then(function (body) { return body.data; });
  }
  function mutate(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency() }, body: JSON.stringify(body) });
  }
  function consentBody(consent, action, version, reason) {
    var pair = currentPair(consent);
    return { action: action, expectedRevision: pair.revision, expectedDigest: pair.digest, reason: reason,
      confirmed: true, confirmationVersion: version };
  }
  function setPill(target, active, review) {
    target.textContent = review ? 'Needs review' : (active ? 'Active' : 'Inactive');
    target.dataset.state = review ? 'review' : (active ? 'active' : 'inactive');
  }
  function button(label, handler, primary) {
    var value = node('button', 'btn ' + (primary ? 'btn-primary' : 'btn-secondary'), label);
    value.type = 'button'; value.addEventListener('click', handler); return value;
  }
  function selectedSource() {
    return state.center && state.center.sources.filter(function (item) {
      return item.sourceKind === state.sourceKind && item.sourceKey === state.sourceKey;
    })[0];
  }
  function sourceBase(kind, key) {
    return '/external-' + kind + '-sources/' + encodeURIComponent(key);
  }
  function isTravel() { return state.sourceKind === 'travel'; }
  function isAsset() { return state.sourceKind === 'asset'; }

  function demoModel(kind) {
    var digest = 'a'.repeat(64), now = new Date().toISOString();
    var consent = { active: true, current: { revision: 1, digest: digest, action: 'grant' }, history: [], total: 1, truncated: false };
    var travel = kind === 'travel', asset = kind === 'asset';
    return {
      center: { version: 'm25-learning-center-v3', authority: 'isolated_demo_postgresql', evaluatedAt: now,
        nativeLabor: consent, nativeEquipment: consent, sourceTotal: 3, sourcesTruncated: false,
        sources: [
          { sourceKind: 'labor', sourceKey: 'crewclock.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false },
          { sourceKind: 'travel', sourceKey: 'fleet.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false },
          { sourceKind: 'asset', sourceKey: 'equipment.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false }
        ],
        learningBoundary: 'Demo records are isolated and illustrative. Learning remains advisory and changes no operating record.' },
      source: { sourceKey: asset ? 'equipment.demo' : (travel ? 'fleet.demo' : 'crewclock.demo'), activeConsent: true, runs: [{ sequence: 4 }], runTotal: 4, runsTruncated: false,
        currentRecords: [{ externalRecordId: asset ? 'chipper-042' : (travel ? 'route-042' : 'tree-crew-042'), sourceUpdatedAt: now }], recordTotal: asset ? 41 : (travel ? 34 : 28), recordsTruncated: false, latestSourceUpdatedAt: now },
      sourceConsent: Object.assign({ sourceKey: asset ? 'equipment.demo' : (travel ? 'fleet.demo' : 'crewclock.demo') }, consent), outcomeConsent: Object.assign({ sourceKey: asset ? 'equipment.demo' : (travel ? 'fleet.demo' : 'crewclock.demo') }, consent),
      healthConsent: Object.assign({ sourceKey: 'equipment.demo' }, consent), calibrationConsent: Object.assign({ sourceKey: asset ? 'equipment.demo' : (travel ? 'fleet.demo' : 'crewclock.demo') }, consent),
      operations: { sourceKey: asset ? 'equipment.demo' : (travel ? 'fleet.demo' : 'crewclock.demo'), adapter: { revision: 2, digest: digest, action: 'resume', adapterKind: 'provider_api', cadence: 'daily' },
        retention: { revision: 1, digest: digest, action: 'set', retentionDays: 365 }, deletion: null,
        checkpoints: [{ mode: 'historical_backfill', sequence: 3, cursorAfter: null, complete: true }, { mode: 'continuous_update', sequence: 4, cursorAfter: 'demo-004', complete: false }],
        activeRecordTotal: asset ? 41 : (travel ? 34 : 28), retentionEligibleTotal: 2, deletionComplete: false,
        boundary: 'Demo cleanup is read-only. Paid cleanup appends minimized tombstones and invalidates dependent advice.' },
      matches: asset ? { sourceKey: 'equipment.demo', activeConsent: true, referenceTotal: 3,
        references: [
          { referenceKind: 'job', externalReference: 'tree-job-042', sourceRecordCount: 8, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '22222222-2222-4222-8222-222222222222', targetDigest: digest, action: 'link', status: 'matched' } },
          { referenceKind: 'vehicle', externalReference: 'chip-truck-2', sourceRecordCount: 5, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '44444444-4444-4444-8444-444444444444', targetDigest: digest, action: 'link', status: 'matched' } },
          { referenceKind: 'equipment', externalReference: 'tracked-chipper-1', sourceRecordCount: 11, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '55555555-5555-4555-8555-555555555555', targetDigest: digest, action: 'link', status: 'matched' } }
        ],
        vehicleTargets: [{ targetId: '44444444-4444-4444-8444-444444444444', name: 'Chip truck 2', manufacturer: 'Ford', model: 'F-550', digest: digest }],
        equipmentTargets: [{ targetId: '55555555-5555-4555-8555-555555555555', name: 'Tracked chipper 1', manufacturer: 'Bandit', model: '21XP', digest: digest }],
        jobTargets: [{ targetId: '22222222-2222-4222-8222-222222222222', opportunityId: '33333333-3333-4333-8333-333333333333', digest: digest }] } : travel ? { sourceKey: 'fleet.demo', activeConsent: true, referenceTotal: 2,
        references: [
          { referenceKind: 'job', externalReference: 'tree-job-042', sourceRecordCount: 6, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '22222222-2222-4222-8222-222222222222', targetDigest: digest, action: 'link', status: 'matched' } },
          { referenceKind: 'vehicle', externalReference: 'chip-truck-2', sourceRecordCount: 6, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '44444444-4444-4444-8444-444444444444', targetDigest: digest, action: 'link', status: 'matched' } }
        ],
        vehicleTargets: [{ targetId: '44444444-4444-4444-8444-444444444444', name: 'Chip truck 2', manufacturer: 'Ford', model: 'F-550', digest: digest }],
        jobTargets: [{ targetId: '22222222-2222-4222-8222-222222222222', opportunityId: '33333333-3333-4333-8333-333333333333', digest: digest }] } :
      { sourceKey: 'crewclock.demo', activeConsent: true, referenceTotal: 3, references: [
          { referenceKind: 'worker', externalReference: 'crew-lead-7', sourceRecordCount: 12, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '11111111-1111-4111-8111-111111111111', targetDigest: digest, action: 'link', status: 'matched' } },
          { referenceKind: 'job', externalReference: 'tree-job-042', sourceRecordCount: 9, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '22222222-2222-4222-8222-222222222222', targetDigest: digest, action: 'link', status: 'matched' } },
          { referenceKind: 'worker', externalReference: 'climber-12', sourceRecordCount: 7, sourceDigest: digest, match: null }
        ],
        workerTargets: [{ targetId: '11111111-1111-4111-8111-111111111111', operationalRole: 'Crew lead', digest: digest }],
        jobTargets: [{ targetId: '22222222-2222-4222-8222-222222222222', opportunityId: '33333333-3333-4333-8333-333333333333', digest: digest }] },
      health: { sourceKey: 'equipment.demo', activeConsent: true, history: [], total: 1, truncated: false,
        current: { fresh: true, advisoryAvailable: true, outcomes: {
          maintenance: { status: 'recorded', recordCount: 3, completedCount: 2, deferredCount: 1, cancelledCount: 0 },
          downtime: { status: 'recorded', recordCount: 2, durationHours: '6.500000', scheduledCount: 1, unscheduledCount: 1 },
          condition: { status: 'unavailable', unavailableReason: 'No current condition observation was recorded. Maintenance and downtime do not establish condition.' },
          availability: { status: 'unavailable', unavailableReason: 'No complete availability observation window was recorded. Downtime alone does not establish availability.' }
        } } },
      calibration: asset ? { sourceKey: 'equipment.demo', serviceKey: 'tree-service', activeConsent: true, history: [], total: 1, truncated: false,
        refreshRequired: false, current: { fresh: true, advisoryAvailable: true, sampleSize: 7, staleExcludedCount: 1,
          metrics: {
            utilization: { status: 'compared', label: 'Machine-hour use', unit: 'machine_hour', medianActualToPlannedRatio: '1.1200', lowerQuartileRatio: '0.9800', upperQuartileRatio: '1.2600', proposedMultiplier: '1.1200', advisoryMessage: 'Reviewed machine-hour use averaged about 12% above plan.', unavailableReason: null },
            operatingCost: { status: 'compared', label: 'Job operating cost', unit: 'USD', medianActualToPlannedRatio: '1.0700', lowerQuartileRatio: '0.9500', upperQuartileRatio: '1.1800', proposedMultiplier: '1.0700', advisoryMessage: 'Reviewed same-currency job operating cost averaged about 7% above plan.', unavailableReason: null }
          } } } : travel ? { sourceKey: 'fleet.demo', serviceKey: 'tree-service', activeConsent: true, history: [], total: 1, truncated: false,
        refreshRequired: false, current: { fresh: true, advisoryAvailable: true, sampleSize: 8, staleExcludedCount: 1,
          metrics: {
            routeDuration: { status: 'compared', label: 'Route duration', unit: 'vehicle_minute', medianActualToPlannedRatio: '1.0800', lowerQuartileRatio: '0.9600', upperQuartileRatio: '1.1700', proposedMultiplier: '1.0800', advisoryMessage: 'Reviewed routes averaged about 8% longer than planned.', unavailableReason: null },
            distance: { status: 'compared', label: 'Driving distance', unit: 'mi', medianActualToPlannedRatio: '1.0300', lowerQuartileRatio: '0.9800', upperQuartileRatio: '1.0900', proposedMultiplier: '1.0300', advisoryMessage: 'Reviewed driving distance averaged about 3% above plan.', unavailableReason: null },
            fuelQuantity: { status: 'unavailable', label: 'Fuel or energy quantity', unit: null, medianActualToPlannedRatio: null, proposedMultiplier: null, advisoryMessage: null, unavailableReason: 'At least five current outcomes with this comparable dimension are required.' },
            fuelCost: { status: 'compared', label: 'Fuel cost', unit: 'USD', medianActualToPlannedRatio: '1.0600', lowerQuartileRatio: '0.9700', upperQuartileRatio: '1.1400', proposedMultiplier: '1.0600', advisoryMessage: 'Reviewed fuel cost averaged about 6% above plan.', unavailableReason: null }
          } } } :
      { sourceKey: 'crewclock.demo', serviceKey: 'tree-service', activeConsent: true, history: [], total: 1, truncated: false,
        refreshRequired: false, current: { fresh: true, advisoryAvailable: true, sampleSize: 8, staleExcludedCount: 1,
          medianActualToPlannedRatio: '1.0800', lowerQuartileRatio: '0.9600', upperQuartileRatio: '1.1700',
          proposedPlannedHoursMultiplier: '1.0800', advisoryMessage: 'Recent reviewed tree-service jobs averaged about 8% more labor time than their adopted plans.' } }
    };
  }

  function renderSummary() {
    var references = state.matches ? state.matches.references : [];
    var review = references.filter(function (item) { return !item.match || item.match.status !== 'matched'; }).length;
    el('learningSummary').hidden = false;
    el('learningSourceCount').textContent = integer(state.center.sourceTotal).toLocaleString();
    el('learningRecordCount').textContent = state.detail ? integer(state.detail.recordTotal).toLocaleString() : '—';
    el('learningReviewCount').textContent = state.matches ? review.toLocaleString() : '—';
    el('learningCalibrationCount').textContent = state.calibration && state.calibration.current && state.calibration.current.fresh ? '1' : '0';
  }
  function renderNative() {
    var consent = state.center.nativeLabor, active = consent.active === true;
    setPill(el('nativeLearningState'), active, false);
    var control = el('nativeLearningAction');
    control.disabled = demo; control.textContent = demo ? 'Demo preview' : (active ? 'Pause comparisons' : 'Allow comparisons');
    control.onclick = demo ? null : function () {
      control.disabled = true; status('Saving completed-job comparison consent.');
      mutate('/labor-duration-consent', consentBody(consent, active ? 'revoke' : 'grant', 'm25-labor-duration-consent-v1',
        active ? 'Owner paused completed-job labor comparisons from the Learning Center.' : 'Owner enabled completed-job labor comparisons from the Learning Center.'))
        .then(load).catch(fail);
    };
    var equipmentConsent = state.center.nativeEquipment, equipmentActive = equipmentConsent.active === true;
    setPill(el('nativeEquipmentLearningState'), equipmentActive, false);
    var equipmentControl = el('nativeEquipmentLearningAction');
    equipmentControl.disabled = demo; equipmentControl.textContent = demo ? 'Demo preview' : (equipmentActive ? 'Pause comparisons' : 'Allow comparisons');
    equipmentControl.onclick = demo ? null : function () {
      equipmentControl.disabled = true; status('Saving vehicle and equipment comparison consent.');
      mutate('/native-equipment-utilization-consent', consentBody(equipmentConsent, equipmentActive ? 'revoke' : 'grant', 'm25-native-equipment-utilization-consent-v1',
        equipmentActive ? 'Owner paused completed-job vehicle and equipment comparisons from the Learning Center.' : 'Owner enabled completed-job vehicle and equipment comparisons from the Learning Center.'))
        .then(load).catch(fail);
    };
  }
  function renderSources() {
    var root = el('learningSources'); clear(root);
    el('sourcesDescription').textContent = state.center.sources.length ?
      'Select a labor, travel, vehicle or equipment source to inspect its consent, evidence, reviewed matches and planning suggestions.' :
      'No external source has been recorded yet. Add the first company source to begin a reviewed connection.';
    state.center.sources.forEach(function (source) {
      var card = node('button', 'learning-source-card'); card.type = 'button';
      card.setAttribute('aria-pressed', String(source.sourceKind === state.sourceKind && source.sourceKey === state.sourceKey));
      card.setAttribute('aria-label', contract.label(source.sourceKey) + ', ' + contract.label(source.sourceKind) + ' source');
      var kind = node('span', 'learning-source-kind', source.sourceKind === 'asset' ? 'Vehicles · equipment' : (source.sourceKind === 'travel' ? 'Travel · mileage · fuel' : 'Labor · time'));
      card.appendChild(kind);
      card.appendChild(node('strong', '', contract.label(source.sourceKey)));
      card.appendChild(node('span', '', source.serviceTotal + ' service ' + (source.serviceTotal === 1 ? 'group' : 'groups') + ' recorded'));
      card.addEventListener('click', function () { selectSource(source.sourceKind, source.sourceKey); }); root.appendChild(card);
    });
  }
  function consentCard(title, description, consent, endpoint, version, blockedText) {
    var card = node('article', 'learning-consent-card'); card.appendChild(node('h3', '', title));
    card.appendChild(node('p', '', description)); var pill = node('span', 'learning-pill'); setPill(pill, consent.active, false); card.appendChild(pill);
    var action = button(demo ? 'Demo preview' : (blockedText || (consent.active ? 'Pause' : 'Allow')), function () {
      action.disabled = true; status('Saving ' + title.toLowerCase() + ' consent.');
      mutate(endpoint, consentBody(consent, consent.active ? 'revoke' : 'grant', version,
        'Owner ' + (consent.active ? 'paused' : 'enabled') + ' ' + title.toLowerCase() + ' from the Learning Center.'))
        .then(function () { return selectSource(state.sourceKind, state.sourceKey, true); }).catch(fail);
    }, false); action.disabled = demo || Boolean(blockedText); if (blockedText) card.appendChild(node('small', '', 'Cancel the active deletion request before starting a new source consent period.')); card.appendChild(node('div', 'learning-actions')).appendChild(action); return card;
  }
  function renderConsentCards() {
    var root = el('learningConsentCards'); clear(root);
    var base = sourceBase(state.sourceKind, state.sourceKey);
    var deletionBlocksGrant = isAsset() && state.operations && state.operations.deletion && state.operations.deletion.action === 'request' && !state.consents.source.active;
    root.appendChild(consentCard('Source import', 'Controls whether records from this named source may be staged.', state.consents.source,
      base + '/consent', isAsset() ? 'm25-external-asset-import-consent-v1' : (isTravel() ? 'm25-external-travel-import-consent-v1' : 'm25-external-labor-import-consent-v1'), deletionBlocksGrant ? 'Cancel deletion first' : null));
    root.appendChild(consentCard('Outcome comparisons', isAsset() ? 'Controls comparisons between matched machine hours, job costs and adopted equipment plans.' : (isTravel() ? 'Controls comparisons between matched route evidence and adopted travel plans.' : 'Controls comparisons between matched imported jobs and adopted labor plans.'), state.consents.outcome,
      base + (isAsset() ? '/imported-utilization-cost-consent' : (isTravel() ? '/imported-travel-variance-consent' : '/imported-labor-duration-consent')), isAsset() ? 'm25-imported-asset-utilization-cost-consent-v1' : (isTravel() ? 'm25-imported-travel-variance-consent-v1' : 'm25-imported-labor-duration-consent-v1')));
    if (isAsset()) root.appendChild(consentCard('Asset health summaries', 'Controls summaries of current maintenance and downtime records for an exact reviewed asset.', state.consents.health,
      base + '/imported-asset-health-consent', 'm25-imported-asset-health-consent-v1'));
    root.appendChild(consentCard('Calibration proposals', 'Controls service-level summaries built from current reviewed comparisons.', state.consents.calibration,
      base + (isAsset() ? '/imported-asset-calibration-consent' : (isTravel() ? '/imported-travel-calibration-consent' : '/imported-labor-calibration-consent')), isAsset() ? 'm25-imported-asset-calibration-consent-v1' : (isTravel() ? 'm25-imported-travel-calibration-consent-v1' : 'm25-imported-labor-calibration-consent-v1')));
  }
  function operationPair(value) { return value ? { expectedRevision: value.revision, expectedDigest: value.digest } : { expectedRevision: 0, expectedDigest: 'none' }; }
  function operationCard(title, description) { var card = node('article', 'learning-operation-card'); card.appendChild(node('h4', '', title)); card.appendChild(node('p', '', description)); return card; }
  function checkpoint(mode) { return (state.operations.checkpoints || []).filter(function (item) { return item.mode === mode; })[0] || null; }
  function saveOperation(path, body, message) {
    status(message); return mutate(sourceBase(state.sourceKind, state.sourceKey) + path, body)
      .then(function () { return selectSource(state.sourceKind, state.sourceKey, true); }).catch(function (error) {
        fail(error);
        renderOperations();
      });
  }
  function renderOperations() {
    var root = el('learningOperations'); clear(root);
    if (!state.operations) { root.appendChild(node('p', 'learning-empty', 'Loading source operations.')); return; }
    var grid = node('div', 'learning-operation-grid'), backfill = checkpoint('historical_backfill');
    if (state.sourceKind === 'labor') {
      var csv = operationCard('CSV history', backfill && backfill.complete ? 'Historical backfill is complete. Current source corrections can continue through the guarded adapter route.' : 'Upload one reviewed NorthStar labor CSV page with no more than 100 records.');
      var file = node('input', 'learning-file'); file.type = 'file'; file.accept = '.csv,text/csv'; file.setAttribute('aria-label', 'Reviewed labor CSV'); file.disabled = demo || !state.consents.source.active || Boolean(backfill && backfill.complete); csv.appendChild(file);
      var pageLabel = node('label', '', 'Backfill progress'); pageLabel.htmlFor = 'learningCsvPageState'; var pageState = node('select'); pageState.id = 'learningCsvPageState';
      [['complete', 'This file is the final page'], ['more', 'More CSV pages follow']].forEach(function (choice) { var option = node('option', '', choice[1]); option.value = choice[0]; pageState.appendChild(option); });
      pageState.disabled = demo || Boolean(backfill && backfill.complete); csv.appendChild(pageLabel); csv.appendChild(pageState);
      var cursorLabel = node('label', '', 'Checkpoint after this page'); cursorLabel.htmlFor = 'learningCsvCursorAfter'; var cursorAfter = node('input'); cursorAfter.id = 'learningCsvCursorAfter'; cursorAfter.type = 'text'; cursorAfter.maxLength = 200; cursorAfter.autocomplete = 'off'; cursorAfter.placeholder = 'Example: payroll-page-002'; cursorAfter.disabled = true; csv.appendChild(cursorLabel); csv.appendChild(cursorAfter);
      pageState.addEventListener('change', function () { cursorAfter.disabled = demo || pageState.value !== 'more'; if (!cursorAfter.disabled) cursorAfter.focus(); });
      var importButton = button(demo ? 'Demo preview' : (backfill && backfill.complete ? 'Backfill complete' : 'Import CSV'), function () {
        if (!file.files || !file.files[0]) { status('Choose a CSV file before importing.', 'error'); return; }
        var complete = pageState.value === 'complete', nextCursor = complete ? null : cursorAfter.value.trim();
        if (!complete && !/^[!-~]{1,200}$/.test(nextCursor)) { status('Enter a 1 to 200 character checkpoint with no spaces for the next page.', 'error'); cursorAfter.focus(); return; }
        importButton.disabled = true; status('Reading and validating the reviewed CSV.');
        file.files[0].text().then(function (text) { return mutate(sourceBase('labor', state.sourceKey) + '/csv-backfill', {
          cursorBefore: backfill && !backfill.complete ? backfill.cursorAfter : null, cursorAfter: nextCursor, complete: complete, csvText: text
        }); }).then(function () { return selectSource('labor', state.sourceKey, true); }).catch(function (error) { importButton.disabled = false; fail(error); });
      }, true); importButton.disabled = demo || !state.consents.source.active || Boolean(backfill && backfill.complete); csv.appendChild(node('div', 'learning-actions')).appendChild(importButton); csv.appendChild(node('small', '', backfill && !backfill.complete ? 'Resume after checkpoint ' + backfill.cursorAfter + '. Required columns are validated before staging.' : 'Required columns are validated before any record is staged.')); grid.appendChild(csv);
    } else {
      var continuous = checkpoint('continuous_update');
       var checkpointCard = operationCard('Import checkpoints', isAsset() ? 'Authorized adapters submit normalized vehicle and equipment records in pages of no more than 100. NorthStar stores the checkpoint, not a provider credential.' : 'Authorized adapters submit normalized route, mileage and fuel records in pages of no more than 100. NorthStar stores the checkpoint, not a provider credential.');
      var checkpointMetrics = node('div', 'learning-compact-metrics');
      checkpointMetrics.appendChild(metric('Historical history', backfill ? (backfill.complete ? 'Complete' : 'In progress') : 'Not started'));
      checkpointMetrics.appendChild(metric('Continuous updates', continuous ? ('Run ' + integer(continuous.sequence)) : 'Not started'));
      checkpointCard.appendChild(checkpointMetrics);
       checkpointCard.appendChild(node('small', '', isAsset() ? 'Machine use, cost, maintenance and downtime retain their source units and evidence basis. Missing dimensions remain unavailable.' : 'Distance and fuel retain their source units and evidence basis. Missing dimensions remain unavailable.'));
      grid.appendChild(checkpointCard);
    }

    var adapter = state.operations.adapter, adapterCard = operationCard('Continuous sync', adapter ? 'Current state: ' + contract.label(adapter.action) + '. Adapter state contains no account reference or provider credential.' : 'Register the source lifecycle before an authorized adapter submits continuous updates.');
    var canConfigure = !adapter || adapter.action === 'disconnect';
    var kindLabel = node('label', '', 'Adapter type'); kindLabel.htmlFor = 'learningAdapterKind'; var kindSelect = node('select'); kindSelect.id = 'learningAdapterKind';
    [['provider_api', 'Provider API'], ['csv', 'CSV handoff']].forEach(function (choice) { var option = node('option', '', choice[1]); option.value = choice[0]; kindSelect.appendChild(option); }); kindSelect.value = adapter ? adapter.adapterKind : 'provider_api'; kindSelect.disabled = demo || !canConfigure; adapterCard.appendChild(kindLabel); adapterCard.appendChild(kindSelect);
    var cadenceLabel = node('label', '', 'Update cadence'); cadenceLabel.htmlFor = 'learningAdapterCadence'; var cadenceSelect = node('select'); cadenceSelect.id = 'learningAdapterCadence';
    [['hourly', 'Hourly'], ['daily', 'Daily'], ['manual', 'Manual']].forEach(function (choice) { var option = node('option', '', choice[1]); option.value = choice[0]; cadenceSelect.appendChild(option); }); cadenceSelect.value = adapter ? adapter.cadence : 'daily'; cadenceSelect.disabled = demo || !canConfigure; adapterCard.appendChild(cadenceLabel); adapterCard.appendChild(cadenceSelect);
    var adapterAction = !adapter || adapter.action === 'disconnect' ? 'connect' : (adapter.action === 'pause' ? 'resume' : 'pause');
    var adapterButton = button(demo ? 'Demo preview' : contract.label(adapterAction) + ' sync', function () {
      var pair = operationPair(adapter); adapterButton.disabled = true;
      saveOperation('/adapter', { action: adapterAction, adapterKind: canConfigure ? kindSelect.value : adapter.adapterKind, cadence: canConfigure ? cadenceSelect.value : adapter.cadence,
        expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, confirmed: true }, 'Saving continuous sync state.');
    }); adapterButton.disabled = demo || !state.consents.source.active;
    var adapterActions = node('div', 'learning-actions'); adapterActions.appendChild(adapterButton);
    if (adapter && adapter.action !== 'disconnect') { var disconnectButton = button('Disconnect sync', function () { var pair = operationPair(adapter); disconnectButton.disabled = true; saveOperation('/adapter', { action: 'disconnect', adapterKind: adapter.adapterKind, cadence: adapter.cadence, expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, confirmed: true }, 'Disconnecting continuous sync.'); }); disconnectButton.disabled = demo; adapterActions.appendChild(disconnectButton); }
    adapterCard.appendChild(adapterActions); grid.appendChild(adapterCard);

    var retention = state.operations.retention, retentionCard = operationCard('Retention', integer(state.operations.retentionEligibleTotal) + ' current records are eligible under the saved policy.');
    var daysLabel = node('label', '', 'Keep source records for days'); daysLabel.htmlFor = 'learningRetentionDays'; var days = node('input'); days.id = 'learningRetentionDays'; days.type = 'number'; days.min = '30'; days.max = '3650'; days.step = '1'; days.value = retention && retention.action === 'set' ? retention.retentionDays : 365; days.disabled = demo; retentionCard.appendChild(daysLabel); retentionCard.appendChild(days);
    var saveRetention = button(demo ? 'Demo preview' : 'Save retention', function () { var pair = operationPair(retention); saveRetention.disabled = true; saveOperation('/retention', { action: 'set', retentionDays: Number(days.value), expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, confirmed: true }, 'Saving the retention policy.'); }); saveRetention.disabled = demo;
    var retentionCheckpoint = checkpoint('retention_cleanup');
    var runRetention = button('Process eligible records', function () { var pair = operationPair(retention); runRetention.disabled = true; saveOperation('/cleanup', { operation: 'retention', expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, cursorBefore: retentionCheckpoint && !retentionCheckpoint.complete ? retentionCheckpoint.cursorAfter : null, limit: 100, confirmed: true }, 'Processing the next retention batch.'); }); runRetention.disabled = demo || !retention || retention.action !== 'set' || state.operations.retentionEligibleTotal < 1;
    var retentionActions = node('div', 'learning-actions'); retentionActions.appendChild(saveRetention); retentionActions.appendChild(runRetention); retentionCard.appendChild(retentionActions); grid.appendChild(retentionCard);

    var deletion = state.operations.deletion, deletionRequested = deletion && deletion.action === 'request'; var deletionCard = operationCard('Delete imported source records', deletionRequested ? (state.operations.deletionComplete ? 'Deletion is complete. Audit receipts retain no work details.' : integer(state.operations.activeRecordTotal) + ' current records remain to be tombstoned.') : 'A deletion request immediately pauses source use and hides dependent learning advice.'); deletionCard.classList.add('learning-danger');
    var deletionAction = button(demo ? 'Demo preview' : (deletionRequested ? 'Cancel request' : 'Request deletion'), function () { var pair = operationPair(deletion); deletionAction.disabled = true; saveOperation('/deletion', { action: deletionRequested ? 'cancel' : 'request', expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, confirmed: true }, deletionRequested ? 'Cancelling the source deletion request.' : 'Requesting source deletion and blocking new use.'); }); deletionAction.disabled = demo;
    var deletionCheckpoint = checkpoint('deletion_cleanup');
    var runDeletion = button('Process next 100', function () { var pair = operationPair(deletion); runDeletion.disabled = true; saveOperation('/cleanup', { operation: 'deletion', expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, cursorBefore: deletionCheckpoint && !deletionCheckpoint.complete ? deletionCheckpoint.cursorAfter : null, limit: 100, confirmed: true }, 'Processing the next deletion batch.'); }); runDeletion.disabled = demo || !deletionRequested || state.operations.deletionComplete;
    var deletionActions = node('div', 'learning-actions'); deletionActions.appendChild(deletionAction); deletionActions.appendChild(runDeletion); deletionCard.appendChild(deletionActions); grid.appendChild(deletionCard);
    root.appendChild(grid); root.appendChild(node('p', 'learning-empty', state.operations.boundary));
  }
  function metric(label, value) { var item = node('div', 'learning-metric'); item.appendChild(node('span', '', label)); item.appendChild(node('strong', '', value)); return item; }
  function renderEvidence() {
    el('evidenceSummary').textContent = state.detail.activeConsent ? (isAsset() ? 'Current staged vehicle and equipment evidence. These records do not change jobs, assets or costs.' : (isTravel() ? 'Current staged route, mileage and fuel evidence. Records remain separate from operating data.' : 'Current staged labor evidence. Records remain separate from operating data.')) : 'Source consent is inactive.';
    var root = el('evidenceMetrics'); clear(root);
    root.appendChild(metric('Import runs', integer(state.detail.runTotal).toLocaleString()));
    root.appendChild(metric('Current records', integer(state.detail.recordTotal).toLocaleString()));
    root.appendChild(metric('References', integer(state.matches.referenceTotal).toLocaleString()));
    root.appendChild(metric('Last source update', state.detail.latestSourceUpdatedAt ? new Date(state.detail.latestSourceUpdatedAt).toLocaleString() : 'None'));
  }
  function targetLabel(kind, target) {
    if (kind === 'worker') return contract.label(target.operationalRole || 'Worker') + ' · ' + String(target.targetId).slice(0, 8);
    if (kind === 'vehicle') return (target.name || [target.manufacturer, target.model].filter(Boolean).join(' ') || 'Vehicle') + ' · ' + String(target.targetId).slice(0, 8);
    if (kind === 'equipment') return (target.name || [target.manufacturer, target.model].filter(Boolean).join(' ') || 'Equipment') + ' · ' + String(target.targetId).slice(0, 8);
    return 'Estimate ' + String(target.targetId).slice(0, 8);
  }
  function renderMatches() {
    var root = el('learningMatches'); clear(root); var references = state.matches.references || [];
    el('matchesSummary').textContent = references.length ? 'Link imported identities to the current company record they describe. Stale links must be reviewed again.' : (isAsset() ? 'No imported vehicle, equipment or job references are available.' : (isTravel() ? 'No imported vehicle or job references are available.' : 'No imported worker or job references are available.'));
    if (!references.length) { root.appendChild(node('p', 'learning-empty', 'No references to review.')); renderAssetHealth(); return; }
    var wrap = node('div', 'learning-table-wrap'), table = node('table', 'learning-table'), head = node('thead'), row = node('tr');
    table.appendChild(node('caption', 'learning-visually-hidden', 'Imported reference review for ' + contract.label(state.sourceKey)));
    ['Type', 'External reference', 'Evidence', 'Status', 'Company record'].forEach(function (label) { var th = node('th', '', label); th.scope = 'col'; row.appendChild(th); }); head.appendChild(row); table.appendChild(head);
    var body = node('tbody');
    references.forEach(function (reference) {
      var tr = node('tr'); tr.appendChild(node('td', '', contract.label(reference.referenceKind))); tr.appendChild(node('td', '', reference.externalReference));
      tr.appendChild(node('td', '', integer(reference.sourceRecordCount) + ' records'));
      var match = reference.match, matchState = match ? match.status : 'unmatched'; var pill = node('span', 'learning-pill', contract.label(matchState)); pill.dataset.state = matchState === 'matched' ? 'current' : (matchState === 'stale' ? 'stale' : 'review'); tr.appendChild(node('td')).appendChild(pill);
      var cell = node('td'), select = node('select'); select.setAttribute('aria-label', 'Company record for ' + reference.externalReference);
      select.appendChild(new Option('Not linked', ''));
      var targets = reference.referenceKind === 'worker' ? state.matches.workerTargets : (reference.referenceKind === 'vehicle' ? state.matches.vehicleTargets : (reference.referenceKind === 'equipment' ? state.matches.equipmentTargets : state.matches.jobTargets));
      targets.forEach(function (target) { var option = new Option(targetLabel(reference.referenceKind, target), target.targetId); option.dataset.digest = target.digest; select.appendChild(option); });
      select.value = match && match.action === 'link' ? match.targetId : ''; select.disabled = demo;
      select.addEventListener('change', function () { saveMatch(reference, select); }); cell.appendChild(select); tr.appendChild(cell); body.appendChild(tr);
    }); table.appendChild(body); wrap.appendChild(table); root.appendChild(wrap); renderAssetHealth();
  }
  function saveMatch(reference, select) {
    var match = reference.match, link = Boolean(select.value), selected = select.options[select.selectedIndex]; select.disabled = true;
    status('Saving the reviewed reference match.');
    mutate(sourceBase(state.sourceKind, state.sourceKey) + '/matches', {
      referenceKind: reference.referenceKind, externalReference: reference.externalReference, action: link ? 'link' : 'unlink', targetId: link ? select.value : null,
      expectedRevision: match ? match.revision : 0, expectedDigest: match ? match.digest : 'none', expectedSourceDigest: reference.sourceDigest || 'unavailable',
      expectedTargetDigest: link ? selected.dataset.digest : 'unavailable', reason: 'Owner reviewed this imported reference in the Learning Center.', confirmed: true,
      confirmationVersion: isAsset() ? 'm25-external-asset-reference-match-v1' : (isTravel() ? 'm25-external-travel-reference-match-v1' : 'm25-external-labor-reference-match-v1')
    }).then(function () { return selectSource(state.sourceKind, state.sourceKey, true); }).catch(fail);
  }
  function assetHealthReferences() {
    return state.matches && isAsset() ? state.matches.references.filter(function (reference) {
      return (reference.referenceKind === 'vehicle' || reference.referenceKind === 'equipment') && reference.match && reference.match.status === 'matched';
    }) : [];
  }
  function healthMetric(label, value, detail) {
    var item = node('section', 'learning-dimension-card'); var heading = node('div', 'learning-dimension-heading');
    heading.appendChild(node('h5', '', label)); var available = value && value.status === 'recorded';
    var pill = node('span', 'learning-pill', available ? 'Recorded' : 'Unavailable'); pill.dataset.state = available ? 'current' : 'inactive'; heading.appendChild(pill); item.appendChild(heading);
    item.appendChild(node('strong', 'learning-dimension-value', available ? detail(value) : 'Not established'));
    item.appendChild(node('small', '', available ? (value.recordCount + ' current source ' + (value.recordCount === 1 ? 'record' : 'records')) : ((value && value.unavailableReason) || 'Current comparable evidence is unavailable.'))); return item;
  }
  function renderAssetHealth() {
    var panel = el('assetHealthPanel'), root = el('learningAssetHealth'); clear(root); panel.hidden = !isAsset();
    if (!isAsset()) return;
    var references = assetHealthReferences();
    if (!references.length) { root.appendChild(node('p', 'learning-empty', 'Review and link a vehicle or equipment reference before preparing a health summary.')); return; }
    var selected = state.healthReference || references[0];
    if (!references.some(function (item) { return item.referenceKind === selected.referenceKind && item.externalReference === selected.externalReference; })) selected = references[0];
    state.healthReference = selected;
    var controls = node('div', 'learning-inline'), label = node('label', '', 'Reviewed asset'), select = node('select'); label.htmlFor = 'learningHealthAsset'; select.id = 'learningHealthAsset';
    references.forEach(function (reference, index) { select.appendChild(new Option(contract.label(reference.referenceKind) + ' · ' + reference.externalReference, String(index))); });
    select.value = String(references.indexOf(selected)); select.addEventListener('change', function () { state.healthReference = references[Number(select.value)]; state.health = null; renderAssetHealth(); loadAssetHealth(state.healthReference); }); controls.appendChild(label); controls.appendChild(select); root.appendChild(controls);
    if (!state.health) { root.appendChild(node('p', 'learning-empty', 'Loading the current maintenance and downtime summary.')); return; }
    var card = node('article', 'learning-calibration-card'), current = state.health.current; card.appendChild(node('h4', '', contract.label(selected.externalReference)));
    if (!current) card.appendChild(node('p', '', state.consents.health && state.consents.health.active ? 'No summary has been prepared for this reviewed asset.' : 'Allow asset health summaries before preparing one.'));
    else {
      card.appendChild(node('p', '', current.fresh ? 'Current source-backed summary. Every dimension remains separate.' : 'This summary is stale. Refresh current evidence before using it.'));
      var outcomes = current.outcomes || {}, grid = node('div', 'learning-travel-calibration-grid');
      grid.appendChild(healthMetric('Maintenance', outcomes.maintenance, function (value) { return value.completedCount + ' completed'; }));
      grid.appendChild(healthMetric('Downtime', outcomes.downtime, function (value) { return value.durationHours + ' hours'; }));
      grid.appendChild(healthMetric('Condition', outcomes.condition, function () { return 'Recorded'; }));
      grid.appendChild(healthMetric('Availability', outcomes.availability, function (value) { return value.percent + '%'; })); card.appendChild(grid);
    }
    var currentAndFresh = Boolean(current && current.fresh === true); var action = button(demo ? 'Demo preview' : (currentAndFresh ? 'Summary current' : (current ? 'Refresh summary' : 'Prepare summary')), function () {
      var consent = state.consents.health; if (!consent || !consent.active || !consent.current) { status('Allow asset health summaries before preparing one.', 'error'); return; }
      action.disabled = true; status('Preparing the current maintenance and downtime summary.');
      mutate(sourceBase('asset', state.sourceKey) + '/imported-asset-health-outcomes', { assetCategory: selected.referenceKind, externalAssetReference: selected.externalReference,
        expectedConsentRevision: consent.current.revision, expectedConsentDigest: consent.current.digest,
        reason: 'Owner requested a current reviewed asset health summary from the Learning Center.', confirmed: true, confirmationVersion: 'm25-imported-asset-health-observation-v1' })
        .then(function () { return loadAssetHealth(selected); }).catch(function (error) { action.disabled = false; fail(error); });
    }, true); action.disabled = demo || !state.consents.health || !state.consents.health.active || currentAndFresh; card.appendChild(node('div', 'learning-actions')).appendChild(action); root.appendChild(card);
  }
  function loadAssetHealth(reference) {
    if (!reference || !isAsset()) return Promise.resolve();
    if (demo) { state.healthReference = reference; state.health = demoModel('asset').health; renderAssetHealth(); return Promise.resolve(); }
    var selectionGeneration = state.selectionGeneration, healthGeneration = ++state.healthGeneration;
    return api(sourceBase('asset', state.sourceKey) + '/imported-asset-health-outcomes?assetCategory=' + encodeURIComponent(reference.referenceKind) + '&externalAssetReference=' + encodeURIComponent(reference.externalReference))
      .then(function (value) { if (selectionGeneration !== state.selectionGeneration || healthGeneration !== state.healthGeneration) return; state.healthReference = reference; state.health = contract.health(value); renderAssetHealth(); })
      .catch(function (error) { if (selectionGeneration === state.selectionGeneration && healthGeneration === state.healthGeneration) fail(error); });
  }
  function renderCalibration() {
    var root = el('learningCalibration'); clear(root); var source = selectedSource();
    el('calibrationTitle').textContent = isAsset() ? 'Vehicle and equipment planning calibration' : (isTravel() ? 'Travel planning calibration' : 'Labor planning calibration');
    el('calibrationDescription').textContent = isAsset() ? 'Review machine-hour use and same-currency job operating cost independently. Maintenance, downtime, condition and availability are not calibrated. Saving a proposal does not apply it.' : (isTravel() ? 'Review route duration, driving distance, fuel quantity and fuel cost independently. Saving a proposal does not apply it.' : 'Review a service-level labor summary. Saving a proposal does not apply it.');
    if (!source || !source.serviceKeys.length) { root.appendChild(node('p', 'learning-empty', 'No service group has enough reviewed imported outcome history yet.')); return; }
    var controls = node('div', 'learning-inline'), label = node('label', '', 'Service group'), select = node('select'); label.htmlFor = 'learningService'; select.id = 'learningService';
    source.serviceKeys.forEach(function (key) { select.appendChild(new Option(contract.label(key), key)); });
    select.value = state.calibration ? state.calibration.serviceKey : source.serviceKeys[0]; select.addEventListener('change', function () { loadCalibration(select.value); }); controls.appendChild(label); controls.appendChild(select); root.appendChild(controls);
    if (!state.calibration) { root.appendChild(node('p', 'learning-empty', 'Loading calibration review.')); return; }
    var card = node('article', 'learning-calibration-card'), current = state.calibration.current;
    card.appendChild(node('h4', '', contract.label(state.calibration.serviceKey)));
    if (!current) card.appendChild(node('p', '', state.calibration.activeConsent ? 'No proposal has been prepared. At least five current reviewed outcomes are required.' : 'Calibration consent is inactive.'));
    else if (isTravel() || isAsset()) {
      card.appendChild(node('p', '', current.fresh ? (isAsset() ? 'Current reviewed vehicle and equipment proposal. Each dimension remains separate.' : 'Current reviewed travel proposal. Each dimension remains separate.') : (isAsset() ? 'The saved vehicle and equipment proposal is stale and must be refreshed before use.' : 'The saved travel proposal is stale and must be refreshed before use.')));
      var travelGrid = node('div', 'learning-travel-calibration-grid');
      (isAsset() ? ['utilization', 'operatingCost'] : ['routeDuration', 'distance', 'fuelQuantity', 'fuelCost']).forEach(function (key) {
        var value = current.metrics && current.metrics[key] ? current.metrics[key] : { status: 'unavailable' };
        var item = node('section', 'learning-dimension-card');
        var title = node('div', 'learning-dimension-heading'); title.appendChild(node('h5', '', value.label || contract.label(key)));
        var dimensionPill = node('span', 'learning-pill', value.status === 'compared' ? 'Compared' : 'Unavailable'); dimensionPill.dataset.state = value.status === 'compared' ? 'current' : 'inactive'; title.appendChild(dimensionPill); item.appendChild(title);
        item.appendChild(node('strong', 'learning-dimension-value', value.proposedMultiplier ? value.proposedMultiplier + '×' : 'No multiplier'));
        item.appendChild(node('small', '', value.status === 'compared' ? ('Median actual-to-plan ratio · ' + value.medianActualToPlannedRatio + (value.unit ? ' · ' + contract.label(value.unit) : '')) : (value.unavailableReason || 'Comparable current evidence is unavailable.')));
        if (value.advisoryMessage) item.appendChild(node('p', '', value.advisoryMessage)); travelGrid.appendChild(item);
      });
      card.appendChild(travelGrid);
    } else {
      card.appendChild(node('p', '', current.fresh ? (current.advisoryMessage || 'Current reviewed proposal.') : 'The saved proposal is stale and must be refreshed before use.'));
      var grid = node('div', 'learning-calibration-grid'); grid.appendChild(metric('Reviewed jobs', String(integer(current.sampleSize))));
      grid.appendChild(metric('Median ratio', current.medianActualToPlannedRatio || 'Unavailable')); grid.appendChild(metric('Planning multiplier', current.proposedPlannedHoursMultiplier || 'Needs refresh')); card.appendChild(grid);
    }
    var currentAndFresh = Boolean(current && current.fresh === true);
    var action = button(demo ? 'Demo preview' : (currentAndFresh ? 'Proposal current' : (current ? 'Refresh proposal' : 'Prepare proposal')), function () {
      var consent = state.consents.calibration; if (!consent.active || !consent.current) { status('Allow calibration proposals before preparing one.', 'error'); return; }
      action.disabled = true; status('Preparing a reviewed advisory proposal.');
       mutate(sourceBase(state.sourceKind, state.sourceKey) + (isAsset() ? '/imported-asset-calibrations/' : (isTravel() ? '/imported-travel-calibrations/' : '/imported-labor-calibrations/')) + encodeURIComponent(state.calibration.serviceKey), {
        expectedConsentRevision: consent.current.revision, expectedConsentDigest: consent.current.digest,
         reason: isAsset() ? 'Owner requested a current service-level vehicle and equipment calibration from the Learning Center.' : (isTravel() ? 'Owner requested a current service-level travel calibration from the Learning Center.' : 'Owner requested a current service-level labor calibration from the Learning Center.'), confirmed: true,
         confirmationVersion: isAsset() ? 'm25-imported-asset-calibration-proposal-v1' : (isTravel() ? 'm25-imported-travel-calibration-proposal-v1' : 'm25-imported-labor-calibration-proposal-v1')
      }).then(function () { return selectSource(state.sourceKind, state.sourceKey, true); }).catch(function (error) { action.disabled = false; fail(error); });
    }, true); action.disabled = demo || !state.consents.calibration.active || currentAndFresh; card.appendChild(node('div', 'learning-actions')).appendChild(action); root.appendChild(card);
  }

  function loadCalibration(serviceKey) {
    if (demo) { state.calibration = demoModel(state.sourceKind).calibration; state.calibration.serviceKey = serviceKey; renderCalibration(); renderSummary(); return Promise.resolve(); }
    var selectionGeneration = state.selectionGeneration, calibrationGeneration = ++state.calibrationGeneration;
    var base = sourceBase(state.sourceKind, state.sourceKey), travel = isTravel(), asset = isAsset();
    state.calibration = null; renderCalibration();
    return api(base + (asset ? '/imported-asset-calibrations/' : (travel ? '/imported-travel-calibrations/' : '/imported-labor-calibrations/')) + encodeURIComponent(serviceKey))
      .then(function (value) {
        if (selectionGeneration !== state.selectionGeneration || calibrationGeneration !== state.calibrationGeneration) return;
        state.calibration = contract.calibration(value); renderCalibration(); renderSummary();
      }).catch(function (error) {
        if (selectionGeneration === state.selectionGeneration && calibrationGeneration === state.calibrationGeneration) fail(error);
      });
  }
  function selectSource(sourceKind, sourceKey, refresh) {
    var generation = ++state.selectionGeneration, travel = sourceKind === 'travel', asset = sourceKind === 'asset'; ++state.calibrationGeneration; ++state.healthGeneration;
    state.sourceKind = sourceKind; state.sourceKey = sourceKey; state.detail = null; state.matches = null; state.calibration = null; state.health = null; state.healthReference = null; state.operations = null;
    renderSources(); el('learningDetail').hidden = true; status('Loading ' + contract.label(sourceKey) + '.'); el('learningMain').setAttribute('aria-busy', 'true');
    if (demo) {
      var model = demoModel(sourceKind); state.detail = model.source; state.consents = { source: model.sourceConsent, outcome: model.outcomeConsent, health: model.healthConsent, calibration: model.calibrationConsent };
      state.matches = model.matches; state.calibration = model.calibration; state.health = asset ? model.health : null; state.healthReference = asset ? assetHealthReferences()[0] : null; state.operations = model.operations; finishDetail(generation); return Promise.resolve();
    }
    var base = sourceBase(sourceKind, sourceKey);
    var outcomeConsentPath = asset ? '/imported-utilization-cost-consent' : (travel ? '/imported-travel-variance-consent' : '/imported-labor-duration-consent');
    var calibrationConsentPath = asset ? '/imported-asset-calibration-consent' : (travel ? '/imported-travel-calibration-consent' : '/imported-labor-calibration-consent');
    var healthConsentRequest = asset ? api(base + '/imported-asset-health-consent') : Promise.resolve(null);
    return Promise.all([api(base), api(base + '/consent'), api(base + '/matches'), api(base + outcomeConsentPath), api(base + calibrationConsentPath), api(base + '/operations'), healthConsentRequest])
      .then(function (values) {
        if (generation !== state.selectionGeneration) return null;
        state.detail = contract.source(values[0]); state.consents = { source: contract.consent(values[1]), outcome: contract.consent(values[3]), health: asset ? contract.consent(values[6]) : null, calibration: contract.consent(values[4]) };
        state.matches = contract.matches(values[2]); state.operations = contract.operations(values[5]); var source = selectedSource();
        var requests = [];
        if (source && source.serviceKeys.length) requests.push(api(base + (asset ? '/imported-asset-calibrations/' : (travel ? '/imported-travel-calibrations/' : '/imported-labor-calibrations/')) + encodeURIComponent(source.serviceKeys[0])).then(function (value) {
          if (generation === state.selectionGeneration) state.calibration = contract.calibration(value);
        })); else state.calibration = null;
        if (asset) { var healthReference = assetHealthReferences()[0]; if (healthReference) requests.push(api(base + '/imported-asset-health-outcomes?assetCategory=' + encodeURIComponent(healthReference.referenceKind) + '&externalAssetReference=' + encodeURIComponent(healthReference.externalReference)).then(function (value) {
              if (generation === state.selectionGeneration) { state.healthReference = healthReference; state.health = contract.health(value); }
        })); }
        return Promise.all(requests);
      }).then(function () { if (generation === state.selectionGeneration) finishDetail(generation); }).catch(function (error) {
        if (generation === state.selectionGeneration) fail(error);
      });
  }
  function finishDetail(generation) {
    if (generation !== state.selectionGeneration || !state.detail || !state.matches || !state.operations) return;
    el('learningDetail').hidden = false; el('learningDetailTitle').textContent = contract.label(state.sourceKey) + ' · ' + contract.label(state.sourceKind);
    setPill(el('learningDetailState'), state.detail.activeConsent, !state.detail.activeConsent); renderConsentCards(); renderOperations(); renderEvidence(); renderMatches(); renderCalibration(); renderSummary();
    status(demo ? 'Showing isolated demo records. Controls are read-only.' : 'Learning Center is current.', 'success'); el('learningMain').setAttribute('aria-busy', 'false');
  }
  function load(preferredKind, preferredKey) {
    if (typeof preferredKind !== 'string' || typeof preferredKey !== 'string') { preferredKind = null; preferredKey = null; }
    var generation = ++state.loadGeneration, entryLoad = state.center === null; ++state.selectionGeneration; ++state.calibrationGeneration; ++state.healthGeneration;
    if (entryLoad) global.scrollTo(0, 0);
    status('Loading your company learning controls.'); el('learningRefresh').disabled = true; el('learningMain').setAttribute('aria-busy', 'true');
    var promise = demo ? Promise.resolve(demoModel('labor').center) : api('/center');
    return promise.then(function (value) {
      if (generation !== state.loadGeneration) return;
      state.center = contract.center(value); state.sourceKind = null; state.sourceKey = null; state.detail = null; state.matches = null; state.calibration = null; state.health = null; state.healthReference = null; state.operations = null;
      el('learningBoundary').textContent = state.center.learningBoundary; renderNative(); renderSources(); renderSummary();
      if (state.center.sources.length) {
        var preferred = state.center.sources.filter(function (source) { return source.sourceKind === preferredKind && source.sourceKey === preferredKey; })[0] || state.center.sources[0];
        return selectSource(preferred.sourceKind, preferred.sourceKey);
      }
      el('learningDetail').hidden = true; status('Learning Center is ready. No external source has been recorded.', 'success');
    }).catch(function (error) {
      if (generation === state.loadGeneration) fail(error);
    }).finally(function () {
      if (generation !== state.loadGeneration) return;
      el('learningRefresh').disabled = false;
      el('learningMain').setAttribute('aria-busy', 'false');
      if (entryLoad) { global.scrollTo(0, 0); global.requestAnimationFrame(function () { global.scrollTo(0, 0); }); }
    });
  }
  function fail(error) {
    status((error && error.message ? error.message : 'Learning Center could not be loaded.') + (error && error.requestId ? ' Request ' + error.requestId + '.' : ''), 'error');
    el('learningRefresh').disabled = false; el('learningMain').setAttribute('aria-busy', 'false');
  }

  el('learningRefresh').addEventListener('click', load);
  el('learningSourceForm').addEventListener('submit', function (event) {
    event.preventDefault(); if (demo) return;
    var input = el('learningSourceKey'), sourceKind = el('learningSourceKind').value, sourceKey = input.value.trim().toLowerCase();
    if (!contract.KEY.test(sourceKey)) { status('Use 2 to 64 lowercase letters, numbers, dots, dashes or underscores.', 'error'); input.focus(); return; }
    el('learningSourceAdd').disabled = true; status('Adding the company source.');
    mutate(sourceBase(sourceKind, sourceKey) + '/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Owner added this company source in the Learning Center.', confirmed: true, confirmationVersion: sourceKind === 'asset' ? 'm25-external-asset-import-consent-v1' : (sourceKind === 'travel' ? 'm25-external-travel-import-consent-v1' : 'm25-external-labor-import-consent-v1') })
      .then(function () { input.value = ''; return load(sourceKind, sourceKey); }).catch(fail).finally(function () { el('learningSourceAdd').disabled = false; });
  });
  if (demo) { el('learningSourceKind').disabled = true; el('learningSourceKey').disabled = true; el('learningSourceAdd').disabled = true; }
  if (demo) load(); else session.guard().then(function (account) {
    if (account && account.user) load();
  });
})(window);
