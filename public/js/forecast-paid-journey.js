(function (global) {
  'use strict';
  var root = document.getElementById('forecast-paid-journey');
  if (!root) return;
  var isDemo = Boolean(global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true);
  var heading = document.getElementById('forecastPaidJourneyHeading');
  var status = document.getElementById('forecastPaidJourneyStatus');
  var detail = document.getElementById('forecastPaidJourneyDetail');
  var refresh = document.getElementById('refreshForecastPaidJourney');
  var form = document.getElementById('forecastPaidJourneyIssueForm');
  var origin = document.getElementById('forecastPaidOrigin');
  var reason = document.getElementById('forecastPaidReason');
  var issue = document.getElementById('issueForecastPaidJourney');
  var currentCard = document.getElementById('forecastPaidJourneyCurrent');
  var value = document.getElementById('forecastPaidJourneyValue');
  var explanation = document.getElementById('forecastPaidJourneyExplanation');
  var coverage = document.getElementById('forecastPaidJourneyCoverage');
  var currentness = document.getElementById('forecastPaidJourneyCurrentness');
  var receipt = document.getElementById('forecastPaidJourneyReceipt');
  var output = document.getElementById('forecastPaidJourneyOutput');
  var rerun = document.getElementById('rerunForecastPaidJourney');
  var review = document.getElementById('reviewForecastPaidJourney');
  var reviewStatus = document.getElementById('forecastPaidJourneyReview');
  var history = document.getElementById('forecastPaidJourneyHistory');
  var reset = document.getElementById('resetForecastPaidJourney');
  var resetConfirm = document.getElementById('forecastPaidJourneyResetConfirm');
  var resetCancel = document.getElementById('cancelForecastPaidJourneyReset');
  var resetProceed = document.getElementById('confirmForecastPaidJourneyReset');
  var generation = 0; var mutationGeneration = 0; var expiryTimer = null;
  var selected = null; var settings = null; var pending = null; var demoRevision = null;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function show(label, message, state) { status.textContent = label; detail.textContent = message; root.dataset.state = state; }
  function clearRun() {
    if (expiryTimer !== null) { global.clearTimeout(expiryTimer); expiryTimer = null; }
    selected = null; currentCard.hidden = true; value.textContent = '';
    explanation.textContent = ''; coverage.textContent = ''; currentness.textContent = '';
    receipt.textContent = ''; output.textContent = ''; reviewStatus.textContent = '';
    history.replaceChildren(); rerun.disabled = true; review.disabled = true;
  }
  function clear() {
    clearRun(); settings = null; origin.value = ''; reason.value = '';
    origin.readOnly = false;
    origin.disabled = true; reason.disabled = true; issue.disabled = true;
    refresh.disabled = false;
    if (resetConfirm) resetConfirm.hidden = true;
  }
  async function request(url, options) {
    if (!global.NorthStarAccountSession || typeof global.NorthStarAccountSession.fetch !== 'function') throw new Error('session');
    var response = await global.NorthStarAccountSession.fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
    var payload = await response.json().catch(function () { return null; });
    if (!response.ok || !payload || payload.success !== true) { var error = new Error('request'); error.status = response.status; throw error; }
    return payload.data;
  }
  async function demoRequest(url, options) {
    if (!global.NorthStarDemoRuntime || typeof global.NorthStarDemoRuntime.fetch !== 'function') throw new Error('demo');
    var response = await global.NorthStarDemoRuntime.fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
    var payload = await response.json().catch(function () { return null; });
    if (!response.ok || !payload || payload.success !== true) { var error = new Error('request'); error.status = response.status; throw error; }
    return payload.data;
  }
  async function demoAction(action, details, key) {
    return demoRequest('/api/demo/forecast/journey/actions', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key,
        'X-NorthStar-Demo-Intent': 'forecast-journey' },
      body: JSON.stringify({ action: action, details: details, expectedRevision: demoRevision }) });
  }
  function settingsReceipt(data) {
    var selectedSettings = data && data.state === 'current' && data.settings;
    if (!selectedSettings || !selectedSettings.settings || selectedSettings.settings.enabled !== true ||
        !Array.isArray(selectedSettings.settings.targets) ||
        selectedSettings.settings.targets.length !== 1 ||
        selectedSettings.settings.targets[0] !== 'revenue.approved_price_flow') return null;
    return { revision: selectedSettings.revision, digest: selectedSettings.digest };
  }
  function renderHistory(events) {
    if (expiryTimer !== null) { global.clearTimeout(expiryTimer); expiryTimer = null; }
    history.replaceChildren();
    events.forEach(function (event) {
      var item = document.createElement('li');
      var text = document.createElement('span');
      text.textContent = 'Revision ' + event.revision + ' · ' + event.action + ' · ' + new Date(event.recordedAt).toLocaleString();
      item.appendChild(text);
      if (event === events[events.length - 1] && event.action === 'requested') {
        var button = document.createElement('button'); button.type = 'button';
        button.className = 'btn btn-secondary btn-sm'; button.textContent = 'Dismiss review';
        button.addEventListener('click', function () { mutateReview('dismissed', event); }); item.appendChild(button);
      }
      history.appendChild(item);
    });
    var latest = events[events.length - 1];
    var expiresAt = Date.parse(latest && latest.expiresAt);
    if (latest && latest.action === 'requested' && Number.isFinite(expiresAt)) {
      expiryTimer = global.setTimeout(function () { expiryTimer = null; load(); },
        Math.max(0, Math.min(expiresAt - Date.now() + 25, 2147483647)));
    }
  }
  function render(data) {
    if (!data || data.version !== 'm26-paid-journey-v1' ||
        data.targetKey !== 'revenue.approved_price_flow' ||
        data.syntheticImplementationEvidenceOnly !== true || data.liveValidationAvailable !== false ||
        data.automaticActionAuthorized !== false) throw new Error('invalid');
    if (isDemo && (data.fictionalDemo !== true || data.accountFree !== true ||
        data.resettable !== true || data.providerCallCount !== 0 ||
        !Number.isSafeInteger(data.demoWorkspaceRevision))) throw new Error('invalid');
    if (isDemo) demoRevision = data.demoWorkspaceRevision;
    if (data.state !== 'current') {
      clearRun();
      if (isDemo && data.state === 'ready' && data.sourceCandidate &&
          UUID.test(data.sourceCandidate.approvedPriceOriginId || '') &&
          data.sourceCandidate.fictional === true) {
        origin.value = data.sourceCandidate.approvedPriceOriginId;
        origin.readOnly = true; origin.disabled = false; reason.disabled = false; issue.disabled = false;
        if (!reason.value) reason.value = 'Review this fictional approved-price forecast journey.';
        show('Fictional journey ready for review',
          data.sourceCandidate.label + ' is isolated synthetic evidence. Issue a practice receipt to continue; no paid or provider API is called.', 'ready');
      } else if (data.state === 'ready' && settings) {
        origin.disabled = false; reason.disabled = false; issue.disabled = false;
        show('Paid journey ready for an exact source origin',
          'The approved-price preference is current. Issuance still requires one exact authorized pre-horizon origin and every source/currentness gate.', 'ready');
      } else {
        origin.disabled = true; reason.disabled = true; issue.disabled = true;
        show((isDemo ? 'Fictional' : 'Paid') + ' journey unavailable · ' + (data.reason || 'unknown_gate'),
          'No forecast value, receipt, explanation, comparison, or handoff identity is available. Refresh after the named gate is corrected.', 'unavailable');
      }
      return;
    }
    var run = data.run;
    if (!run || !UUID.test(run.id || '') || run.target?.key !== 'revenue.approved_price_flow' ||
        run.output?.predictionKind !== 'deterministic_point' || run.explanation?.customerSafe !== true ||
        run.review?.receiverMutationCount !== 0) throw new Error('invalid');
    selected = run; currentCard.hidden = false; origin.disabled = true; reason.disabled = true; issue.disabled = true;
    value.textContent = run.output.value.amount + ' ' + run.output.unit.currency;
    explanation.textContent = run.explanation.summary;
    coverage.textContent = run.explanation.sourceCoverage;
    currentness.textContent = isDemo ? 'Unchanged fictional candidate · review required' : 'Unchanged candidate · review required';
    receipt.textContent = run.receipt.digest; output.textContent = run.output.digest;
    rerun.disabled = false; renderHistory(run.review.history);
    var last = run.review.history[run.review.history.length - 1];
    review.disabled = Boolean(last && last.action === 'requested');
    reviewStatus.textContent = 'Receiving workflow unavailable: no exact adapter exists. Requesting review changes only immutable Mission 26 history.';
    show(isDemo ? 'Fictional approved-price journey is current' : 'Paid approved-price journey is current',
      isDemo
        ? 'Every value and identity comes from one persisted fictional receipt. No browser calculation, paid API, provider call, or receiving mutation occurred.'
        : 'Every displayed value and explanation comes from one immutable saved receipt. No browser calculation or receiving mutation occurred.', 'current');
  }
  async function load() {
    var token = ++generation; mutationGeneration += 1; clear(); refresh.disabled = true;
    if (isDemo) demoRevision = null;
    show(isDemo ? 'Loading fictional forecast journey…' : 'Loading paid forecast journey…',
      isDemo ? 'Fictional values and identities stay cleared until the isolated demo receipt is verified.' :
        'Values and identities stay cleared until every paid-tenant gate is current.', 'loading');
    try {
      if (isDemo) {
        var demoData = await demoRequest('/api/demo/forecast/journey');
        if (token !== generation) return; render(demoData);
      } else {
        var results = await Promise.all([request('/api/v1/forecast/settings'), request('/api/v1/forecast/paid-journey')]);
        if (token !== generation) return;
        settings = settingsReceipt(results[0]); render(results[1]);
      }
    } catch (_error) {
      if (token !== generation) return; clear();
      show(isDemo ? 'Fictional forecast journey unavailable' : 'Paid forecast journey unavailable',
        isDemo ? 'NorthStar could not verify the isolated fictional workspace. No earlier values or identities remain displayed.' :
          'NorthStar could not verify current paid-tenant evidence. No earlier values or identities remain displayed.', 'unavailable');
    } finally { if (token === generation) refresh.disabled = false; }
  }
  async function issueRun(event) {
    event.preventDefault(); if ((!isDemo && !settings) || (isDemo && !Number.isSafeInteger(demoRevision)) || issue.disabled) return;
    if (!UUID.test(origin.value.trim()) || reason.value.trim().length < 10) {
      show('Review the source request', 'Enter one exact approved-price origin receipt and a review reason of at least 10 characters.', 'invalid'); return;
    }
    var body = isDemo
      ? { approvedPriceOriginId: origin.value.trim(), reason: reason.value.trim() }
      : { expectedSettingsRevision: settings.revision, expectedSettingsDigest: settings.digest,
        approvedPriceOriginId: origin.value.trim(), reason: reason.value.trim() };
    if (!pending || JSON.stringify(pending.body) !== JSON.stringify(body)) pending = { body: body, key: global.crypto.randomUUID() };
    var token = generation; var mutation = ++mutationGeneration;
    origin.disabled = true; reason.disabled = true; issue.disabled = true;
    show(isDemo ? 'Issuing fictional forecast receipt…' : 'Issuing immutable paid forecast receipt…',
      isDemo ? 'NorthStar is pinning the isolated source, method, cutoff, and fictional workspace revision.' :
        'NorthStar is rechecking source, settings, method, cutoff, and tenant authority.', 'loading');
    try {
      var data = isDemo ? await demoAction('issue', pending.body, pending.key) :
        await request('/api/v1/forecast/paid-journey/issue', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key }, body: JSON.stringify(pending.body) });
      if (token !== generation || mutation !== mutationGeneration) return;
      pending = null; render(data);
    } catch (_error) { if (token === generation && mutation === mutationGeneration) { clear(); show('Issue result unconfirmed', 'Refresh before trying again. Values and receipts remain cleared.', 'unavailable'); } }
  }
  async function checkRerun() {
    if (!selected || rerun.disabled) return; var token = generation;
    var mutation = ++mutationGeneration; var runId = selected.id;
    rerun.disabled = true; reviewStatus.textContent = '';
    try {
      var data = isDemo ? await demoAction('rerun', { runId: selected.id,
        runDigest: selected.receipt.digest, currentnessDigest: selected.currentness.digest }, global.crypto.randomUUID()) :
        await request('/api/v1/forecast/paid-journey/' + encodeURIComponent(selected.id) + '/rerun', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': global.crypto.randomUUID() }, body: '{}' });
      if (token !== generation || mutation !== mutationGeneration || !selected || selected.id !== runId) return;
      if (isDemo && Number.isSafeInteger(data.demoWorkspaceRevision)) demoRevision = data.demoWorkspaceRevision;
      if (data.state === 'reproduced' && data.sameResults === true) reviewStatus.textContent = isDemo
        ? 'Reproduced from the exact retained fictional inputs. No paid, provider, or receiving action was taken.'
        : 'Reproduced from retained authorized inputs with the exact implementation. No action was taken.';
      else { clear(); show('Controlled rerun unavailable', 'Exact preserved inputs or current authority could not be verified.', 'unavailable'); }
    } catch (_error) { if (token === generation && mutation === mutationGeneration) { clear(); show('Controlled rerun unavailable', 'No approximate or current-input reconstruction was used.', 'unavailable'); } }
    finally { if (token === generation && mutation === mutationGeneration && selected && selected.id === runId) rerun.disabled = false; }
  }
  async function mutateReview(action, lastEvent) {
    if (!selected) return; var token = generation; var mutation = ++mutationGeneration;
    var runId = selected.id;
    var details = { runId: selected.id, runDigest: selected.receipt.digest,
      currentnessDigest: selected.currentness.digest,
      expectedRevision: action === 'requested' ? null : lastEvent.revision,
      expectedDigest: action === 'requested' ? null : lastEvent.digest,
      expiresAt: action === 'requested' ? new Date(Date.now() + 7 * 86400000).toISOString() : lastEvent.expiresAt };
    var body = Object.assign({ action: action }, details);
    review.disabled = true;
    try {
      var data = isDemo ? await demoAction(action, details, global.crypto.randomUUID()) :
        await request('/api/v1/forecast/paid-journey/review', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': global.crypto.randomUUID() }, body: JSON.stringify(body) });
      if (token !== generation || mutation !== mutationGeneration || !selected || selected.id !== runId) return;
      if (isDemo) render(data);
      else {
        if (!data || !['requested','dismissed','replay'].includes(data.state) || !data.journey) throw new Error('invalid');
        render(data.journey);
      }
    } catch (_error) { if (token === generation && mutation === mutationGeneration) { clear(); show('Review result unconfirmed', 'Refresh before reviewing again. No receiving workflow was changed.', 'unavailable'); } }
  }
  async function resetDemoJourney() {
    if (!isDemo || !Number.isSafeInteger(demoRevision) || resetProceed.disabled) return;
    var token = generation; var mutation = ++mutationGeneration; resetProceed.disabled = true;
    show('Resetting fictional journey…', 'NorthStar is starting a new isolated demo workspace.', 'loading');
    try {
      var data = await demoRequest('/api/demo/command-center/reset', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': global.crypto.randomUUID(),
          'X-NorthStar-Demo-Intent': 'reset' }, body: JSON.stringify({ expectedRevision: demoRevision }) });
      if (token !== generation || mutation !== mutationGeneration) return;
      demoRevision = data.integrity.revision;
      await global.NorthStarDemoRuntime.loadWorkspace(true);
    } catch (_error) {
      if (token === generation && mutation === mutationGeneration) {
        clear(); show('Reset result unconfirmed', 'Refresh before trying again. Fictional values and identities remain cleared.', 'unavailable');
      }
    } finally { resetProceed.disabled = false; }
  }
  if (isDemo) {
    heading.textContent = 'Fictional approved-price forecast journey';
    reset.hidden = false;
    reset.addEventListener('click', function () { resetConfirm.hidden = false; resetCancel.focus(); });
    resetCancel.addEventListener('click', function () { resetConfirm.hidden = true; reset.focus(); });
    resetConfirm.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { resetCancel.click(); event.preventDefault(); }
    });
    resetProceed.addEventListener('click', resetDemoJourney);
  }
  refresh.addEventListener('click', load); form.addEventListener('submit', issueRun);
  rerun.addEventListener('click', checkRerun); review.addEventListener('click', function () { mutateReview('requested', null); });
  global.addEventListener('pagehide', function () { generation += 1; mutationGeneration += 1; pending = null; clear(); });
  global.addEventListener('northstar:auth-generation', function () { if (!isDemo) { generation += 1; mutationGeneration += 1; pending = null; clear(); load(); } });
  global.addEventListener('northstar:demo-workspace', function () { if (isDemo) { generation += 1; mutationGeneration += 1; pending = null; clear(); load(); } });
  load();
})(window);
