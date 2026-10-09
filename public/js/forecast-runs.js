(function (global) {
  'use strict';

  var root = document.getElementById('forecast-runs');
  if (!root) return;
  var status = document.getElementById('forecastRunsStatus');
  var detail = document.getElementById('forecastRunsDetail');
  var issueForm = document.getElementById('forecastRunIssueForm');
  var month = document.getElementById('forecastRunMonth');
  var issue = document.getElementById('issueForecastRun');
  var refresh = document.getElementById('refreshForecastRuns');
  var currentCard = document.getElementById('forecastRunCurrent');
  var currentValue = document.getElementById('forecastRunValue');
  var currentCutoff = document.getElementById('forecastRunCutoff');
  var currentSettings = document.getElementById('forecastRunSettings');
  var currentDigest = document.getElementById('forecastRunDigest');
  var currentOutputDigest = document.getElementById('forecastRunOutputDigest');
  var rerun = document.getElementById('rerunForecastRun');
  var rerunResult = document.getElementById('forecastRerunResult');
  var history = document.getElementById('forecastRunHistory');
  var empty = document.getElementById('forecastRunEmpty');
  var compareForm = document.getElementById('forecastRunCompareForm');
  var left = document.getElementById('forecastRunLeft');
  var right = document.getElementById('forecastRunRight');
  var compare = document.getElementById('compareForecastRuns');
  var comparison = document.getElementById('forecastRunComparison');
  var runs = [];
  var selected = null;
  var issueAttempt = null;
  var generation = 0;
  var controllers = new Set();
  var demoExpiryTimer = null;
  var DIGEST = /^[0-9a-f]{64}$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function show(label, explanation, state) {
    status.textContent = label; detail.textContent = explanation; root.dataset.state = state;
  }
  function locked(value) {
    month.disabled = !value; issue.disabled = !value;
    left.disabled = !value || runs.length < 2;
    right.disabled = !value || runs.length < 2;
    compare.disabled = !value || runs.length < 2;
    rerun.disabled = !value || !selected;
  }
  function clear() {
    runs = []; selected = null;
    currentCard.hidden = true;
    currentValue.textContent = ''; currentCutoff.textContent = '';
    currentSettings.textContent = ''; currentDigest.textContent = '';
    currentOutputDigest.textContent = ''; rerunResult.textContent = '';
    history.replaceChildren(); empty.hidden = false;
    compareForm.hidden = true; left.replaceChildren(); right.replaceChildren();
    comparison.textContent = ''; locked(false);
  }
  function cancel() {
    generation += 1;
    controllers.forEach(function (controller) { controller.abort(); });
    controllers.clear();
  }
  function clearDemoExpiry() {
    if (demoExpiryTimer !== null) global.clearTimeout(demoExpiryTimer);
    demoExpiryTimer = null;
  }
  async function request(url, options) {
    if (!global.NorthStarAccountSession ||
        typeof global.NorthStarAccountSession.fetch !== 'function') throw new Error('Session unavailable');
    var controller = new AbortController(); controllers.add(controller);
    var timer = global.setTimeout(function () { controller.abort(); }, 10000);
    try {
      var response = await global.NorthStarAccountSession.fetch(url, Object.assign({
        credentials: 'same-origin', signal: controller.signal,
      }, options || {}));
      var payload = await response.json().catch(function () { return null; });
      if (!response.ok) {
        var error = new Error(payload && payload.error && payload.error.message || 'Forecast run unavailable');
        error.status = response.status;
        error.category = payload && payload.error && payload.error.category;
        throw error;
      }
      if (!payload || payload.success !== true) throw new Error('Forecast run response invalid');
      return payload.data;
    } finally {
      global.clearTimeout(timer); controllers.delete(controller);
    }
  }
  function validRun(run) {
    if (!run || run.state !== 'current' || !run.receipt || !Array.isArray(run.values) ||
        run.values.length !== 1 || !run.currentness || run.currentness.sourceCurrent !== true ||
        run.currentness.algorithmCurrent !== true || run.currentness.settingsRecorded !== true ||
        run.currentness.refreshRequired !== false || !run.historyPosition ||
        typeof run.historyPosition.latest !== 'boolean' ||
        typeof run.historyPosition.superseded !== 'boolean') return false;
    var receipt = run.receipt, value = run.values[0];
    return receipt.version === 'm26-forecast-run-receipt-v2' && UUID.test(receipt.id || '') &&
      DIGEST.test(receipt.digest || '') && DIGEST.test(receipt.inputDigest || '') &&
      DIGEST.test(receipt.resultDigest || '') && DIGEST.test(receipt.sourceSnapshotDigest || '') &&
      DIGEST.test(receipt.reportingWindowDigest || '') && DIGEST.test(receipt.featureSetDigest || '') &&
      receipt.settings && Number.isSafeInteger(receipt.settings.revision) &&
      receipt.settings.revision >= 1 && DIGEST.test(receipt.settings.digest || '') &&
      receipt.algorithm && DIGEST.test(receipt.algorithm.definitionDigest || '') &&
      DIGEST.test(receipt.algorithm.implementationDigest || '') &&
      DIGEST.test(receipt.algorithm.buildDigest || '') && Array.isArray(receipt.outputs) &&
      receipt.outputs.length === 1 && receipt.outputs[0].outputDigest === value.outputDigest &&
      value.targetKey === 'demand.inbound_leads' && value.targetVersion === 'v1' &&
      value.unit && value.unit.key === 'count' && value.unit.currency === null &&
      value.value && value.value.kind === 'point' &&
      /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?$/.test(value.value.amount || '') &&
      DIGEST.test(value.outputDigest || '');
  }
  function label(run) {
    return new Date(run.receipt.asOf).toLocaleString() + ' · ' + run.values[0].value.amount + ' leads';
  }
  function renderSelected(id) {
    selected = runs.find(function (run) { return run.receipt.id === id; }) || null;
    currentCard.hidden = !selected; rerunResult.textContent = '';
    Array.from(history.querySelectorAll('button')).forEach(function (button) {
      button.setAttribute('aria-current', String(Boolean(selected && button.dataset.runId === selected.receipt.id)));
    });
    if (!selected) { locked(false); return; }
    var receipt = selected.receipt, value = selected.values[0];
    currentValue.textContent = value.value.amount;
    currentCutoff.textContent = new Date(receipt.asOf).toLocaleString();
    currentSettings.textContent = 'Revision ' + receipt.settings.revision + ' · ' + receipt.settings.digest;
    currentDigest.textContent = receipt.digest;
    currentOutputDigest.textContent = value.outputDigest;
    if (global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true) {
      locked(false); left.disabled = runs.length < 2; right.disabled = runs.length < 2;
      compare.disabled = runs.length < 2;
    } else locked(true);
  }
  function selectOptions() {
    [left, right].forEach(function (select, selectIndex) {
      select.replaceChildren();
      runs.forEach(function (run, index) {
        var option = document.createElement('option');
        option.value = run.receipt.id; option.textContent = label(run);
        if (index === (selectIndex === 0 ? runs.length - 1 : 0)) option.selected = true;
        select.append(option);
      });
    });
  }
  function renderList(data) {
    if (!data || data.state !== 'current' || !Array.isArray(data.runs) ||
        data.runs.length > 20 || data.runs.some(function (run) { return !validRun(run); })) {
      throw new Error('Forecast run history invalid');
    }
    clear(); runs = data.runs.slice();
    empty.hidden = runs.length !== 0;
    runs.forEach(function (run) {
      var item = document.createElement('li');
      var button = document.createElement('button'); button.type = 'button';
      button.dataset.runId = run.receipt.id;
      var title = document.createElement('strong'); title.textContent = label(run);
      var evidence = document.createElement('span');
      evidence.textContent = (run.historyPosition.latest ? 'Latest stored receipt' :
        run.historyPosition.superseded ? 'Superseded stored receipt' : 'Earlier stored receipt') +
        ' · ' + run.receipt.digest + ' · settings r' + run.receipt.settings.revision;
      button.append(title, evidence); item.append(button); history.append(item);
      button.addEventListener('click', function () { renderSelected(run.receipt.id); });
    });
    if (runs.length) renderSelected(runs[0].receipt.id);
    compareForm.hidden = runs.length < 2;
    if (runs.length >= 2) selectOptions();
    locked(true);
    show(runs.length ? 'Forecast run receipts are current' : 'No forecast runs issued',
      runs.length ? 'Stored values are shown only while their retained source and exact algorithm identities remain current.' :
        'An owner or administrator may choose a future month and issue from the current enabled settings. No default month is assumed.',
      'current');
  }
  function unavailable(reason) {
    clear();
    var known = {
      settings_not_enabled: 'Forecast settings are disabled or no longer current.',
      settings_not_current: 'Forecast settings changed. Stored values and receipt details are withheld.',
      source_or_algorithm_not_current: 'Source or algorithm evidence changed. Stored values and receipts are withheld.',
      retained_inputs_unavailable: 'Required retained inputs are unavailable. Stored values and receipts are withheld.',
      run_not_found: 'The selected run is unavailable.',
    };
    show('Forecast run evidence unavailable', known[reason] ||
      'NorthStar could not verify current run evidence. Refresh to recover; earlier values and digests remain cleared.', 'unavailable');
  }
  async function load() {
    cancel(); clear(); issueAttempt = null; refresh.disabled = true;
    show('Loading forecast receipts.', 'Values and digests stay cleared until current paid-workspace authority is verified.', 'loading');
    var token = generation;
    try {
      var data = await request('/api/v1/forecast/runs');
      if (token !== generation) return;
      if (data && data.state === 'unavailable') { unavailable(data.reason); return; }
      renderList(data);
    } catch (error) {
      if (token !== generation) return;
      clear();
      show(error.status === 401 ? 'Sign in required' : error.status === 403 ? 'Access restricted' : 'Forecast run history unavailable',
        error.status === 401 || error.status === 403 ?
          'Only a current paid-workspace owner or administrator can review forecast run receipts.' :
          'NorthStar could not verify current run evidence. Refresh to recover; earlier values and digests remain cleared.', 'unavailable');
    } finally { if (token === generation) refresh.disabled = false; }
  }
  async function issueRun(event) {
    event.preventDefault();
    if (issue.disabled || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month.value)) {
      show('Choose a forecast month', 'Select a future monthly horizon before issuing a reviewed forecast.', 'invalid'); return;
    }
    var chosen = month.value + '-01';
    cancel(); clear(); refresh.disabled = true;
    show('Issuing reviewed forecast.', 'The calculation and immutable receipt are stored together. No automatic action is authorized.', 'loading');
    var token = generation;
    try {
      var settings = await request('/api/v1/forecast/settings');
      if (token !== generation) return;
      if (!settings || settings.state !== 'current' || !settings.settings ||
          settings.settings.revision < 1 || !DIGEST.test(settings.settings.digest || '') ||
          !settings.settings.settings || settings.settings.settings.enabled !== true) {
        unavailable('settings_not_enabled'); return;
      }
      var body = { expectedSettingsRevision: settings.settings.revision,
        expectedSettingsDigest: settings.settings.digest, localHorizonStart: chosen,
        supersedes: null };
      if (!issueAttempt || JSON.stringify(issueAttempt.body) !== JSON.stringify(body)) {
        issueAttempt = { key: global.crypto.randomUUID(), body: body };
      }
      var saved = await request('/api/v1/forecast/runs', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': issueAttempt.key },
        body: JSON.stringify(issueAttempt.body) });
      if (token !== generation) return;
      if (saved && saved.state === 'unavailable') { issueAttempt = null; unavailable(saved.reason); return; }
      if (!validRun(saved)) throw new Error('Forecast run receipt invalid');
      issueAttempt = null;
      await load();
    } catch (error) {
      if (token !== generation) return;
      clear();
      show(error.status === 409 ? 'Forecast evidence changed' : 'Forecast issue result unconfirmed',
        error.status === 409 ? 'Settings or source evidence changed. Refresh and review before issuing again.' :
          'NorthStar could not confirm a stored receipt. Refresh before trying again; earlier values and digests remain cleared.',
        'unavailable');
    } finally { if (token === generation) refresh.disabled = false; }
  }
  async function compareRuns(event) {
    event.preventDefault();
    if (left.value === right.value || compare.disabled) {
      comparison.textContent = 'Choose two different stored receipts.'; return;
    }
    if (global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true) {
      comparison.textContent =
        'Input changed: the fictional reporting window and result identities differ. This is not a reproduction.';
      return;
    }
    comparison.textContent = ''; locked(false);
    try {
      var result = await request('/api/v1/forecast/runs/compare/' +
        encodeURIComponent(left.value) + '/' + encodeURIComponent(right.value));
      if (result.state === 'unavailable') { unavailable(result.reason); return; }
      if (!result || !['reproduced','result_mismatch','input_changed'].includes(result.state) ||
          !DIGEST.test(result.digest || '')) throw new Error('Comparison invalid');
      comparison.textContent = result.state === 'reproduced' ?
        'Reproduced: distinct stored runs pin identical inputs and identical result manifests.' :
        result.state === 'result_mismatch' ?
          'Result mismatch: identical pinned inputs produced different stored result manifests.' :
          'Input changed: settings, source, window, feature, algorithm, or cutoff identity differs. This is not a reproduction.';
    } catch (_error) {
      comparison.textContent = '';
      unavailable('source_or_algorithm_not_current');
    } finally { if (root.dataset.state !== 'unavailable') locked(true); }
  }
  async function controlledRerun() {
    if (!selected || rerun.disabled) return;
    var runId = selected.receipt.id;
    rerunResult.textContent = ''; locked(false);
    try {
      var result = await request('/api/v1/forecast/runs/' + encodeURIComponent(runId) + '/controlled-rerun', {
        method: 'POST', headers: { 'Content-Type': 'application/json',
          'Idempotency-Key': global.crypto.randomUUID() }, body: '{}',
      });
      if (result.state === 'unavailable') { unavailable(result.reason); return; }
      if (!result || !['reproduced','result_mismatch'].includes(result.state) ||
          result.automaticActionAuthorized !== false) throw new Error('Rerun invalid');
      rerunResult.textContent = result.state === 'reproduced' ?
        'Reproduced from retained authorized inputs with the exact executable algorithm version. No action was taken.' :
        'Result mismatch: the fresh controlled output differs from the stored result. Review is required; no action was taken.';
    } catch (_error) { unavailable('retained_inputs_unavailable'); }
    finally { if (root.dataset.state !== 'unavailable') locked(true); }
  }
  function demoExpired() {
    clearDemoExpiry(); cancel(); clear();
    refresh.hidden = true; month.disabled = true; issue.hidden = true; rerun.hidden = true;
    show('Fictional forecast receipts expired',
      'The fictional session expired. Receipt values, digests, and comparisons were cleared. Start or refresh a demo workspace to recover.',
      'unavailable');
  }
  function scheduleDemoExpiry(expiresAt) {
    clearDemoExpiry();
    var remaining = expiresAt - Date.now();
    if (remaining <= 0) { demoExpired(); return; }
    demoExpiryTimer = global.setTimeout(function () { scheduleDemoExpiry(expiresAt); },
      Math.min(remaining, 2147483647));
  }
  function demo(workspace) {
    clearDemoExpiry(); cancel(); clear(); refresh.hidden = true; month.disabled = true; issue.hidden = true;
    var expiresAt = workspace && workspace.session && Date.parse(workspace.session.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) { demoExpired(); return; }
    var digest = function (character) { return character.repeat(64); };
    var make = function (id, cutoff, amount, character) {
      return { state: 'current', receipt: { version: 'm26-forecast-run-receipt-v2', id: id,
        organizationId: 'd0000000-0000-4000-8000-000000000001', asOf: cutoff,
        createdAt: cutoff, settings: { revision: 2, digest: digest('a') },
        sourceSnapshotDigest: digest('b'), reportingWindowDigest: digest(character),
        featureSetDigest: digest('d'), algorithm: { key: 'fictional_monthly_example',
          version: 'fictional-v1', definitionDigest: digest('e'),
          implementationDigest: digest('f'), buildDigest: digest('1') },
        calculationVersion: 'fictional-example-v1', outputContractVersion: 'm26-forecast-output-v1',
        outputs: [{ targetKey: 'demand.inbound_leads', targetVersion: 'v1', outputDigest: digest(character) }],
        supersedes: null, supersessionReason: null, inputDigest: digest(character),
        resultDigest: digest(character), digest: digest(character) },
        values: [{ targetKey: 'demand.inbound_leads', targetVersion: 'v1',
          unit: { key: 'count', currency: null }, value: { kind: 'point', amount: amount },
          outputDigest: digest(character) }], currentness: { sourceCurrent: true,
          algorithmCurrent: true, settingsRecorded: true, refreshRequired: false },
        historyPosition: { latest: id.endsWith('12'), superseded: false } };
    };
    runs = [make('d0000000-0000-4000-8000-000000000012','2026-10-01T12:00:00.000Z','19','2'),
      make('d0000000-0000-4000-8000-000000000011','2026-09-01T12:00:00.000Z','17','3')];
    renderList({ state: 'current', runs: runs });
    locked(false); history.querySelectorAll('button').forEach(function (button) { button.disabled = false; });
    rerun.hidden = true; compareForm.hidden = false; compare.disabled = false; left.disabled = false; right.disabled = false;
    show('Fictional forecast receipts',
      'This isolated demo uses synthetic evidence and makes no paid forecast calls. Receipt comparison is illustrative and authorizes no action.', 'demo');
    scheduleDemoExpiry(expiresAt);
  }
  function initializeDemo() {
    clearDemoExpiry(); cancel(); clear(); refresh.hidden = true;
    month.disabled = true; issue.hidden = true; rerun.hidden = true;
    show('Loading fictional forecast receipts.',
      'Values and digests stay cleared until the fictional workspace is current.', 'loading');
    if (!global.NorthStarDemoRuntime ||
        typeof global.NorthStarDemoRuntime.loadWorkspace !== 'function') {
      demoExpired(); return;
    }
    global.NorthStarDemoRuntime.loadWorkspace(false).then(demo).catch(demoExpired);
  }

  issueForm.addEventListener('submit', issueRun);
  compareForm.addEventListener('submit', compareRuns);
  rerun.addEventListener('click', controlledRerun);
  refresh.addEventListener('click', load);
  global.addEventListener('pagehide', function () { clearDemoExpiry(); cancel(); clear(); });
  global.addEventListener('northstar:auth-generation', function () { cancel(); clear(); load(); });
  global.addEventListener('northstar:demo-workspace', function (event) {
    if (global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true &&
        event && event.detail) demo(event.detail);
  });
  if (global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true) initializeDemo();
  else load();
})(window);
