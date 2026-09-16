(function (global) {
  'use strict';

  var contract = global.NorthStarLearningCenterContract;
  var session = global.NorthStarAccountSession;
  var demo = global.location.pathname.indexOf('/demo/') === 0;
  var state = { center: null, sourceKey: null, detail: null, consents: {}, matches: null, calibration: null, operations: null };
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

  function demoModel() {
    var digest = 'a'.repeat(64), now = new Date().toISOString();
    var consent = { active: true, current: { revision: 1, digest: digest, action: 'grant' }, history: [], total: 1, truncated: false };
    return {
      center: { version: 'm25-learning-center-v1', authority: 'isolated_demo_postgresql', evaluatedAt: now,
        nativeLabor: consent, sourceTotal: 1, sourcesTruncated: false,
        sources: [{ sourceKey: 'crewclock.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false }],
        learningBoundary: 'Demo records are isolated and illustrative. Learning remains advisory and changes no operating record.' },
      source: { sourceKey: 'crewclock.demo', activeConsent: true, runs: [{ sequence: 4 }], runTotal: 4, runsTruncated: false,
        currentRecords: [{ externalRecordId: 'tree-crew-042', sourceUpdatedAt: now }], recordTotal: 28, recordsTruncated: false, latestSourceUpdatedAt: now },
      sourceConsent: Object.assign({ sourceKey: 'crewclock.demo' }, consent), outcomeConsent: Object.assign({ sourceKey: 'crewclock.demo' }, consent),
      calibrationConsent: Object.assign({ sourceKey: 'crewclock.demo' }, consent),
      operations: { sourceKey: 'crewclock.demo', adapter: { revision: 2, digest: digest, action: 'resume', adapterKind: 'provider_api', cadence: 'daily' },
        retention: { revision: 1, digest: digest, action: 'set', retentionDays: 365 }, deletion: null,
        checkpoints: [{ mode: 'historical_backfill', sequence: 3, cursorAfter: null, complete: true }],
        activeRecordTotal: 28, retentionEligibleTotal: 2, deletionComplete: false,
        boundary: 'Demo cleanup is read-only. Paid cleanup appends minimized tombstones and invalidates dependent advice.' },
      matches: { sourceKey: 'crewclock.demo', activeConsent: true, referenceTotal: 3,
        references: [
          { referenceKind: 'worker', externalReference: 'crew-lead-7', sourceRecordCount: 12, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '11111111-1111-4111-8111-111111111111', targetDigest: digest, action: 'link', status: 'matched' } },
          { referenceKind: 'job', externalReference: 'tree-job-042', sourceRecordCount: 9, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '22222222-2222-4222-8222-222222222222', targetDigest: digest, action: 'link', status: 'matched' } },
          { referenceKind: 'worker', externalReference: 'climber-12', sourceRecordCount: 7, sourceDigest: digest, match: null }
        ],
        workerTargets: [{ targetId: '11111111-1111-4111-8111-111111111111', operationalRole: 'Crew lead', digest: digest }],
        jobTargets: [{ targetId: '22222222-2222-4222-8222-222222222222', opportunityId: '33333333-3333-4333-8333-333333333333', digest: digest }] },
      calibration: { sourceKey: 'crewclock.demo', serviceKey: 'tree-service', activeConsent: true, history: [], total: 1, truncated: false,
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
  }
  function renderSources() {
    var root = el('learningSources'); clear(root);
    el('sourcesDescription').textContent = state.center.sources.length ?
      'Select a company source to inspect its consent, evidence, reference matches and service-level calibrations.' :
      'No external labor source has been recorded yet. Add the first source, then import its reviewed CSV history.';
    state.center.sources.forEach(function (source) {
      var card = node('button', 'learning-source-card'); card.type = 'button';
      card.setAttribute('aria-pressed', String(source.sourceKey === state.sourceKey));
      card.appendChild(node('strong', '', contract.label(source.sourceKey)));
      card.appendChild(node('span', '', source.serviceTotal + ' service ' + (source.serviceTotal === 1 ? 'group' : 'groups') + ' recorded'));
      card.addEventListener('click', function () { selectSource(source.sourceKey); }); root.appendChild(card);
    });
  }
  function consentCard(title, description, consent, endpoint, version) {
    var card = node('article', 'learning-consent-card'); card.appendChild(node('h3', '', title));
    card.appendChild(node('p', '', description)); var pill = node('span', 'learning-pill'); setPill(pill, consent.active, false); card.appendChild(pill);
    var action = button(demo ? 'Demo preview' : (consent.active ? 'Pause' : 'Allow'), function () {
      action.disabled = true; status('Saving ' + title.toLowerCase() + ' consent.');
      mutate(endpoint, consentBody(consent, consent.active ? 'revoke' : 'grant', version,
        'Owner ' + (consent.active ? 'paused' : 'enabled') + ' ' + title.toLowerCase() + ' from the Learning Center.'))
        .then(function () { return selectSource(state.sourceKey, true); }).catch(fail);
    }, false); action.disabled = demo; card.appendChild(node('div', 'learning-actions')).appendChild(action); return card;
  }
  function renderConsentCards() {
    var root = el('learningConsentCards'); clear(root); var key = encodeURIComponent(state.sourceKey);
    root.appendChild(consentCard('Source import', 'Controls whether records from this named source may be staged.', state.consents.source,
      '/external-labor-sources/' + key + '/consent', 'm25-external-labor-import-consent-v1'));
    root.appendChild(consentCard('Outcome comparisons', 'Controls comparisons between matched imported jobs and adopted labor plans.', state.consents.outcome,
      '/external-labor-sources/' + key + '/imported-labor-duration-consent', 'm25-imported-labor-duration-consent-v1'));
    root.appendChild(consentCard('Calibration proposals', 'Controls service-level summaries built from current reviewed comparisons.', state.consents.calibration,
      '/external-labor-sources/' + key + '/imported-labor-calibration-consent', 'm25-imported-labor-calibration-consent-v1'));
  }
  function operationPair(value) { return value ? { expectedRevision: value.revision, expectedDigest: value.digest } : { expectedRevision: 0, expectedDigest: 'none' }; }
  function operationCard(title, description) { var card = node('article', 'learning-operation-card'); card.appendChild(node('h4', '', title)); card.appendChild(node('p', '', description)); return card; }
  function checkpoint(mode) { return (state.operations.checkpoints || []).filter(function (item) { return item.mode === mode; })[0] || null; }
  function saveOperation(path, body, message) {
    status(message); return mutate('/external-labor-sources/' + encodeURIComponent(state.sourceKey) + path, body)
      .then(function () { return selectSource(state.sourceKey, true); }).catch(function (error) {
        fail(error);
        renderOperations();
      });
  }
  function renderOperations() {
    var root = el('learningOperations'); clear(root);
    if (!state.operations) { root.appendChild(node('p', 'learning-empty', 'Loading source operations.')); return; }
    var grid = node('div', 'learning-operation-grid'), backfill = checkpoint('historical_backfill');
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
      file.files[0].text().then(function (text) { return mutate('/external-labor-sources/' + encodeURIComponent(state.sourceKey) + '/csv-backfill', {
        cursorBefore: backfill && !backfill.complete ? backfill.cursorAfter : null, cursorAfter: nextCursor, complete: complete, csvText: text
      }); }).then(function () { return selectSource(state.sourceKey, true); }).catch(function (error) { importButton.disabled = false; fail(error); });
    }, true); importButton.disabled = demo || !state.consents.source.active || Boolean(backfill && backfill.complete); csv.appendChild(node('div', 'learning-actions')).appendChild(importButton); csv.appendChild(node('small', '', backfill && !backfill.complete ? 'Resume after checkpoint ' + backfill.cursorAfter + '. Required columns are validated before staging.' : 'Required columns are validated before any record is staged.')); grid.appendChild(csv);

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
    el('evidenceSummary').textContent = state.detail.activeConsent ? 'Current staged evidence for this source. Records remain separate from operating data.' : 'Source consent is inactive.';
    var root = el('evidenceMetrics'); clear(root);
    root.appendChild(metric('Import runs', integer(state.detail.runTotal).toLocaleString()));
    root.appendChild(metric('Current records', integer(state.detail.recordTotal).toLocaleString()));
    root.appendChild(metric('References', integer(state.matches.referenceTotal).toLocaleString()));
    root.appendChild(metric('Last source update', state.detail.latestSourceUpdatedAt ? new Date(state.detail.latestSourceUpdatedAt).toLocaleString() : 'None'));
  }
  function targetLabel(kind, target) {
    if (kind === 'worker') return contract.label(target.operationalRole || 'Worker') + ' · ' + String(target.targetId).slice(0, 8);
    return 'Estimate ' + String(target.targetId).slice(0, 8);
  }
  function renderMatches() {
    var root = el('learningMatches'); clear(root); var references = state.matches.references || [];
    el('matchesSummary').textContent = references.length ? 'Link imported identities to the current company record they describe. Stale links must be reviewed again.' : 'No imported worker or job references are available.';
    if (!references.length) { root.appendChild(node('p', 'learning-empty', 'No references to review.')); return; }
    var wrap = node('div', 'learning-table-wrap'), table = node('table', 'learning-table'), head = node('thead'), row = node('tr');
    ['Type', 'External reference', 'Evidence', 'Status', 'Company record'].forEach(function (label) { row.appendChild(node('th', '', label)); }); head.appendChild(row); table.appendChild(head);
    var body = node('tbody');
    references.forEach(function (reference) {
      var tr = node('tr'); tr.appendChild(node('td', '', contract.label(reference.referenceKind))); tr.appendChild(node('td', '', reference.externalReference));
      tr.appendChild(node('td', '', integer(reference.sourceRecordCount) + ' records'));
      var match = reference.match, matchState = match ? match.status : 'unmatched'; var pill = node('span', 'learning-pill', contract.label(matchState)); pill.dataset.state = matchState === 'matched' ? 'current' : (matchState === 'stale' ? 'stale' : 'review'); tr.appendChild(node('td')).appendChild(pill);
      var cell = node('td'), select = node('select'); select.setAttribute('aria-label', 'Company record for ' + reference.externalReference);
      select.appendChild(new Option('Not linked', ''));
      var targets = reference.referenceKind === 'worker' ? state.matches.workerTargets : state.matches.jobTargets;
      targets.forEach(function (target) { var option = new Option(targetLabel(reference.referenceKind, target), target.targetId); option.dataset.digest = target.digest; select.appendChild(option); });
      select.value = match && match.action === 'link' ? match.targetId : ''; select.disabled = demo;
      select.addEventListener('change', function () { saveMatch(reference, select); }); cell.appendChild(select); tr.appendChild(cell); body.appendChild(tr);
    }); table.appendChild(body); wrap.appendChild(table); root.appendChild(wrap);
  }
  function saveMatch(reference, select) {
    var match = reference.match, link = Boolean(select.value), selected = select.options[select.selectedIndex]; select.disabled = true;
    status('Saving the reviewed reference match.');
    mutate('/external-labor-sources/' + encodeURIComponent(state.sourceKey) + '/matches', {
      referenceKind: reference.referenceKind, externalReference: reference.externalReference, action: link ? 'link' : 'unlink', targetId: link ? select.value : null,
      expectedRevision: match ? match.revision : 0, expectedDigest: match ? match.digest : 'none', expectedSourceDigest: reference.sourceDigest || 'unavailable',
      expectedTargetDigest: link ? selected.dataset.digest : 'unavailable', reason: 'Owner reviewed this imported reference in the Learning Center.', confirmed: true,
      confirmationVersion: 'm25-external-labor-reference-match-v1'
    }).then(function () { return selectSource(state.sourceKey, true); }).catch(fail);
  }
  function renderCalibration() {
    var root = el('learningCalibration'); clear(root); var source = state.center.sources.filter(function (item) { return item.sourceKey === state.sourceKey; })[0];
    if (!source || !source.serviceKeys.length) { root.appendChild(node('p', 'learning-empty', 'No service group has enough reviewed imported outcome history yet.')); return; }
    var controls = node('div', 'learning-inline'), label = node('label', '', 'Service group'), select = node('select'); label.htmlFor = 'learningService'; select.id = 'learningService';
    source.serviceKeys.forEach(function (key) { select.appendChild(new Option(contract.label(key), key)); });
    select.value = state.calibration ? state.calibration.serviceKey : source.serviceKeys[0]; select.addEventListener('change', function () { loadCalibration(select.value); }); controls.appendChild(label); controls.appendChild(select); root.appendChild(controls);
    if (!state.calibration) { root.appendChild(node('p', 'learning-empty', 'Loading calibration review.')); return; }
    var card = node('article', 'learning-calibration-card'), current = state.calibration.current;
    card.appendChild(node('h4', '', contract.label(state.calibration.serviceKey)));
    if (!current) card.appendChild(node('p', '', state.calibration.activeConsent ? 'No proposal has been prepared. At least five current reviewed outcomes are required.' : 'Calibration consent is inactive.'));
    else {
      card.appendChild(node('p', '', current.fresh ? (current.advisoryMessage || 'Current reviewed proposal.') : 'The saved proposal is stale and must be refreshed before use.'));
      var grid = node('div', 'learning-calibration-grid'); grid.appendChild(metric('Reviewed jobs', String(integer(current.sampleSize))));
      grid.appendChild(metric('Median ratio', current.medianActualToPlannedRatio || 'Unavailable')); grid.appendChild(metric('Planning multiplier', current.proposedPlannedHoursMultiplier || 'Needs refresh')); card.appendChild(grid);
    }
    var currentAndFresh = Boolean(current && current.fresh === true);
    var action = button(demo ? 'Demo preview' : (currentAndFresh ? 'Proposal current' : (current ? 'Refresh proposal' : 'Prepare proposal')), function () {
      var consent = state.consents.calibration; if (!consent.active || !consent.current) { status('Allow calibration proposals before preparing one.', 'error'); return; }
      action.disabled = true; status('Preparing a reviewed advisory proposal.');
      mutate('/external-labor-sources/' + encodeURIComponent(state.sourceKey) + '/imported-labor-calibrations/' + encodeURIComponent(state.calibration.serviceKey), {
        expectedConsentRevision: consent.current.revision, expectedConsentDigest: consent.current.digest,
        reason: 'Owner requested a current service-level labor calibration from the Learning Center.', confirmed: true,
        confirmationVersion: 'm25-imported-labor-calibration-proposal-v1'
      }).then(function () { return selectSource(state.sourceKey, true); }).catch(function (error) { action.disabled = false; fail(error); });
    }, true); action.disabled = demo || !state.consents.calibration.active || currentAndFresh; card.appendChild(node('div', 'learning-actions')).appendChild(action); root.appendChild(card);
  }

  function loadCalibration(serviceKey) {
    if (demo) { state.calibration = demoModel().calibration; state.calibration.serviceKey = serviceKey; renderCalibration(); renderSummary(); return Promise.resolve(); }
    state.calibration = null; renderCalibration();
    return api('/external-labor-sources/' + encodeURIComponent(state.sourceKey) + '/imported-labor-calibrations/' + encodeURIComponent(serviceKey))
      .then(function (value) { state.calibration = contract.calibration(value); renderCalibration(); renderSummary(); }).catch(fail);
  }
  function selectSource(sourceKey, refresh) {
    state.sourceKey = sourceKey; renderSources(); status('Loading ' + contract.label(sourceKey) + '.');
    if (demo) {
      var model = demoModel(); state.detail = model.source; state.consents = { source: model.sourceConsent, outcome: model.outcomeConsent, calibration: model.calibrationConsent };
      state.matches = model.matches; state.calibration = model.calibration; state.operations = model.operations; finishDetail(); return Promise.resolve();
    }
    var key = encodeURIComponent(sourceKey), base = '/external-labor-sources/' + key;
    return Promise.all([api(base), api(base + '/consent'), api(base + '/matches'), api(base + '/imported-labor-duration-consent'), api(base + '/imported-labor-calibration-consent'), api(base + '/operations')])
      .then(function (values) {
        state.detail = contract.source(values[0]); state.consents = { source: contract.consent(values[1]), outcome: contract.consent(values[3]), calibration: contract.consent(values[4]) };
        state.matches = contract.matches(values[2]); state.operations = contract.operations(values[5]); var source = state.center.sources.filter(function (item) { return item.sourceKey === sourceKey; })[0];
        if (source && source.serviceKeys.length) return api(base + '/imported-labor-calibrations/' + encodeURIComponent(source.serviceKeys[0])).then(function (value) { state.calibration = contract.calibration(value); });
        state.calibration = null;
      }).then(finishDetail).catch(fail);
  }
  function finishDetail() {
    el('learningDetail').hidden = false; el('learningDetailTitle').textContent = contract.label(state.sourceKey);
    setPill(el('learningDetailState'), state.detail.activeConsent, !state.detail.activeConsent); renderConsentCards(); renderOperations(); renderEvidence(); renderMatches(); renderCalibration(); renderSummary();
    status(demo ? 'Showing isolated demo records. Controls are read-only.' : 'Learning Center is current.', 'success');
  }
  function load() {
    status('Loading your tenant-private learning controls.'); el('learningRefresh').disabled = true;
    var promise = demo ? Promise.resolve(demoModel().center) : api('/center');
    return promise.then(function (value) {
      state.center = contract.center(value); state.sourceKey = null; state.detail = null; state.matches = null; state.calibration = null; state.operations = null;
      el('learningBoundary').textContent = state.center.learningBoundary; renderNative(); renderSources(); renderSummary();
      if (state.center.sources.length) return selectSource(state.center.sources[0].sourceKey);
      el('learningDetail').hidden = true; status('Learning Center is ready. No external source has been recorded.', 'success');
    }).catch(fail).finally(function () { el('learningRefresh').disabled = false; });
  }
  function fail(error) {
    status((error && error.message ? error.message : 'Learning Center could not be loaded.') + (error && error.requestId ? ' Request ' + error.requestId + '.' : ''), 'error');
    el('learningRefresh').disabled = false;
  }

  el('learningRefresh').addEventListener('click', load);
  el('learningSourceForm').addEventListener('submit', function (event) {
    event.preventDefault(); if (demo) return;
    var input = el('learningSourceKey'), sourceKey = input.value.trim().toLowerCase();
    if (!contract.KEY.test(sourceKey)) { status('Use 2 to 64 lowercase letters, numbers, dots, dashes or underscores.', 'error'); input.focus(); return; }
    el('learningSourceAdd').disabled = true; status('Adding the company source.');
    mutate('/external-labor-sources/' + encodeURIComponent(sourceKey) + '/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Owner added this company source in the Learning Center.', confirmed: true, confirmationVersion: 'm25-external-labor-import-consent-v1' })
      .then(function () { input.value = ''; return load(); }).then(function () { return selectSource(sourceKey, true); }).catch(fail).finally(function () { el('learningSourceAdd').disabled = false; });
  });
  if (demo) { el('learningSourceKey').disabled = true; el('learningSourceAdd').disabled = true; }
  if (demo) load(); else session.guard().then(function (account) {
    if (account && account.user) load();
  });
})(window);
