(function (global) {
  'use strict';

  var contract = global.NorthStarLearningCenterContract;
  var session = global.NorthStarAccountSession;
  var demo = global.location.pathname.indexOf('/demo/') === 0;
  var state = { center: null, sourceKey: null, detail: null, consents: {}, matches: null, calibration: null };
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
      'No external labor source has been recorded yet. Import setup will be available in the next Learning Center package.';
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
    var action = button(demo ? 'Demo preview' : (current ? 'Refresh proposal' : 'Prepare proposal'), function () {
      var consent = state.consents.calibration; if (!consent.active || !consent.current) { status('Allow calibration proposals before preparing one.', 'error'); return; }
      action.disabled = true; status('Preparing a reviewed advisory proposal.');
      mutate('/external-labor-sources/' + encodeURIComponent(state.sourceKey) + '/imported-labor-calibrations/' + encodeURIComponent(state.calibration.serviceKey), {
        expectedConsentRevision: consent.current.revision, expectedConsentDigest: consent.current.digest,
        reason: 'Owner requested a current service-level labor calibration from the Learning Center.', confirmed: true,
        confirmationVersion: 'm25-imported-labor-calibration-proposal-v1'
      }).then(function () { return selectSource(state.sourceKey, true); }).catch(fail);
    }, true); action.disabled = demo || !state.consents.calibration.active; card.appendChild(node('div', 'learning-actions')).appendChild(action); root.appendChild(card);
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
      state.matches = model.matches; state.calibration = model.calibration; finishDetail(); return Promise.resolve();
    }
    var key = encodeURIComponent(sourceKey), base = '/external-labor-sources/' + key;
    return Promise.all([api(base), api(base + '/consent'), api(base + '/matches'), api(base + '/imported-labor-duration-consent'), api(base + '/imported-labor-calibration-consent')])
      .then(function (values) {
        state.detail = contract.source(values[0]); state.consents = { source: contract.consent(values[1]), outcome: contract.consent(values[3]), calibration: contract.consent(values[4]) };
        state.matches = contract.matches(values[2]); var source = state.center.sources.filter(function (item) { return item.sourceKey === sourceKey; })[0];
        if (source && source.serviceKeys.length) return api(base + '/imported-labor-calibrations/' + encodeURIComponent(source.serviceKeys[0])).then(function (value) { state.calibration = contract.calibration(value); });
        state.calibration = null;
      }).then(finishDetail).catch(fail);
  }
  function finishDetail() {
    el('learningDetail').hidden = false; el('learningDetailTitle').textContent = contract.label(state.sourceKey);
    setPill(el('learningDetailState'), state.detail.activeConsent, !state.detail.activeConsent); renderConsentCards(); renderEvidence(); renderMatches(); renderCalibration(); renderSummary();
    status(demo ? 'Showing isolated demo records. Controls are read-only.' : 'Learning Center is current.', 'success');
  }
  function load() {
    status('Loading your tenant-private learning controls.'); el('learningRefresh').disabled = true;
    var promise = demo ? Promise.resolve(demoModel().center) : api('/center');
    return promise.then(function (value) {
      state.center = contract.center(value); state.sourceKey = null; state.detail = null; state.matches = null; state.calibration = null;
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
  if (demo) load(); else session.guard().then(function (account) {
    if (account && account.user) load();
  });
})(window);
