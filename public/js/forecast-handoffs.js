(function (global) {
  'use strict';

  var root = document.getElementById('forecast-handoffs');
  if (!root) return;
  var status = document.getElementById('forecastHandoffsStatus');
  var detail = document.getElementById('forecastHandoffsDetail');
  var refresh = document.getElementById('refreshForecastHandoffs');
  var candidateCard = document.getElementById('forecastHandoffCandidate');
  var recommendation = document.getElementById('forecastHandoffRecommendation');
  var evidence = document.getElementById('forecastHandoffEvidence');
  var uncertainty = document.getElementById('forecastHandoffUncertainty');
  var missing = document.getElementById('forecastHandoffMissing');
  var tradeoff = document.getElementById('forecastHandoffTradeoff');
  var receiver = document.getElementById('forecastHandoffReceiver');
  var requestButton = document.getElementById('requestForecastHandoff');
  var history = document.getElementById('forecastHandoffHistory');
  var empty = document.getElementById('forecastHandoffEmpty');
  var candidate = null;
  var proposals = [];
  var generation = 0;
  var controllers = new Set();
  var pending = null;
  var expiryTimer = null;
  var DIGEST = /^[0-9a-f]{64}$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function show(label, explanation, state) {
    status.textContent = label; detail.textContent = explanation; root.dataset.state = state;
  }
  function clear() {
    candidate = null; proposals = []; candidateCard.hidden = true;
    recommendation.textContent = ''; evidence.textContent = ''; uncertainty.textContent = '';
    missing.textContent = ''; tradeoff.textContent = ''; receiver.textContent = '';
    history.replaceChildren(); empty.hidden = false; requestButton.disabled = true;
  }
  function cancel() {
    generation += 1; controllers.forEach(function (controller) { controller.abort(); });
    controllers.clear();
  }
  function paidGeneration(token) {
    return token === generation &&
      (!global.NorthStarDemoRuntime || global.NorthStarDemoRuntime.active !== true);
  }
  function clearExpiry() {
    if (expiryTimer !== null) global.clearTimeout(expiryTimer);
    expiryTimer = null;
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
        var error = new Error(payload && payload.error && payload.error.message || 'Reviewed handoff unavailable');
        error.status = response.status; throw error;
      }
      if (!payload || payload.success !== true) throw new Error('Reviewed handoff response invalid');
      return payload.data;
    } finally { global.clearTimeout(timer); controllers.delete(controller); }
  }
  function validReceiver(value) {
    return value && value.mission === '22' && value.workflow === 'calendar_capacity_review' &&
      value.recordId === null && value.expectedRevision === null && value.expectedDigest === null &&
      value.availability === 'unavailable' &&
      value.reason === 'exact_receiving_record_not_available' && value.href === null;
  }
  function validCandidate(value) {
    return value && UUID.test(value.runId || '') && DIGEST.test(value.runDigest || '') &&
      value.targetKey === 'demand.inbound_leads' && value.targetVersion === 'v1' &&
      value.horizon && value.horizon.grain === 'month' &&
      /^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(value.horizon.localStart || '') &&
      DIGEST.test(value.outputDigest || '') && value.currentness &&
      Number.isSafeInteger(value.currentness.revision) && value.currentness.revision >= 1 &&
      DIGEST.test(value.currentness.digest || '') && value.recommendation &&
      value.recommendation.type === 'review_demand_capacity' &&
      value.recommendation.evidence && value.recommendation.evidence.predictionKind === 'point' &&
      /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?$/.test(value.recommendation.evidence.amount || '') &&
      value.recommendation.evidence.unit === 'count' &&
      value.recommendation.evidence.runDigest === value.runDigest &&
      value.recommendation.evidence.outputDigest === value.outputDigest &&
      value.recommendation.uncertainty && value.recommendation.uncertainty.state === 'unquantified' &&
      Array.isArray(value.recommendation.uncertainty.drivers) &&
      Array.isArray(value.recommendation.missingInformation) &&
      typeof value.recommendation.tradeoff === 'string' && validReceiver(value.receiver) &&
      value.advisoryOnly === true && value.navigationIsApproval === false &&
      value.receiverRecheckRequired === true && value.automaticActionAuthorized === false;
  }
  function validProposal(value) {
    return value && value.version === 'm26-forecast-reviewed-handoff-v1' &&
      UUID.test(value.id || '') && ['requested','dismissed','consumed','withdrawn','expired'].includes(value.state) &&
      Number.isSafeInteger(value.revision) && value.revision >= 1 &&
      value.run && candidate && value.run.id === candidate.runId &&
      value.run.currentnessDigest === candidate.currentness.digest &&
      DIGEST.test(value.digest || '') && DIGEST.test(value.proposalDigest || '') &&
      Array.isArray(value.history) && value.history.length === value.revision &&
      validReceiver(value.receiver) && value.advisoryOnly === true &&
      value.navigationIsApproval === false && value.receiverRecheckRequired === true &&
      value.automaticActionAuthorized === false && value.outboundCommunicationAuthorized === false;
  }
  function unavailable(reason) {
    clearExpiry(); clear(); pending = null;
    var known = {
      run_not_found: 'No authenticated saved forecast run is available for review.',
      settings_not_current: 'Forecast settings changed. Handoff values and history are withheld.',
      dependency_index_unavailable: 'The immutable run dependency index could not be verified.',
      unsupported_source_currentness: 'This run source does not yet have an accepted lifecycle reader, so a reviewed handoff cannot be requested.',
      source_currentness_unknown: 'The saved source currentness could not be authenticated.',
      algorithm_unknown: 'The exact saved algorithm and build can no longer be verified.',
      run_stale: 'The saved forecast run is stale. Issue a new authenticated run before requesting review.',
      run_identity_unavailable: 'The exact run, output, horizon, or currentness identity could not be verified.',
      proposal_expired: 'That review request expired. Refresh current evidence before requesting another review.',
    };
    show('Reviewed handoff unavailable', known[reason] ||
      'NorthStar could not verify current review authority. Refresh to recover; proposal identities and history remain cleared.', 'unavailable');
  }
  function renderCandidate(value) {
    candidate = value; candidateCard.hidden = false; requestButton.disabled = false;
    recommendation.textContent = value.recommendation.summary;
    evidence.textContent = value.recommendation.evidence.amount + ' inbound leads · point forecast · count';
    uncertainty.textContent = 'Uncertainty is unquantified: ' +
      value.recommendation.uncertainty.drivers.join(', ').replaceAll('_', ' ') + '.';
    missing.textContent = 'Still needed: ' +
      value.recommendation.missingInformation.join(', ').replaceAll('_', ' ') + '.';
    tradeoff.textContent = value.recommendation.tradeoff;
    receiver.textContent = 'Mission 22 calendar review is unavailable until NorthStar can identify and recheck one exact receiving record. No link or action is exposed.';
  }
  function renderHistory(items, demoMode) {
    history.replaceChildren(); proposals = items.slice(); empty.hidden = proposals.length !== 0;
    proposals.forEach(function (proposal) {
      var item = document.createElement('li');
      var title = document.createElement('strong');
      title.textContent = proposal.state === 'requested' ? 'Review requested' :
        proposal.state === 'dismissed' ? 'Review dismissed' :
          proposal.state === 'expired' ? 'Review expired' : 'Review ' + proposal.state;
      var meta = document.createElement('span');
      meta.textContent = 'Revision ' + proposal.revision + ' · expires ' +
        new Date(proposal.expiresAt).toLocaleString() + ' · ' + proposal.digest;
      item.append(title, meta);
      if (proposal.state === 'requested') {
        var actions = document.createElement('div'); actions.className = 'forecast-handoff-actions';
        var note = document.createElement('span');
        note.textContent = 'Requesting review did not change the calendar, staffing, equipment, price, billing, or customer communication.';
        var dismiss = document.createElement('button'); dismiss.type = 'button';
        dismiss.className = 'btn btn-secondary btn-sm'; dismiss.textContent = 'Dismiss review';
        if (!demoMode) dismiss.addEventListener('click', function () { dismissReview(proposal, dismiss); });
        actions.append(note, dismiss); item.append(actions);
      }
      history.append(item);
    });
  }
  function schedulePaidExpiry(items) {
    var expiries = items.map(function (item) { return Date.parse(item.expiresAt); })
      .filter(Number.isFinite);
    if (expiries.length === 0) return;
    var delay = Math.max(0, Math.min.apply(Math, expiries) - Date.now());
    expiryTimer = global.setTimeout(load, Math.min(delay + 10, 2147483647));
  }
  function render(data) {
    if (!data || data.version !== 'm26-forecast-reviewed-handoff-v1' ||
        data.automaticActionAuthorized !== false ||
        data.outboundCommunicationAuthorized !== false) throw new Error('Reviewed handoff response invalid');
    if (data.state === 'unavailable') { unavailable(data.reason); return; }
    if (data.state !== 'current' || data.reason !== null || !validCandidate(data.candidate) ||
        !Array.isArray(data.proposals)) throw new Error('Reviewed handoff response invalid');
    clear(); renderCandidate(data.candidate);
    if (data.proposals.some(function (proposal) { return !validProposal(proposal); })) {
      throw new Error('Reviewed handoff history invalid');
    }
    renderHistory(data.proposals); schedulePaidExpiry(data.proposals);
    show('Reviewed handoff ready for an explicit review request',
      'This stores advice and review history only. The receiving workflow remains unavailable until it can recheck an exact current record.', 'current');
  }
  async function load() {
    cancel(); clear(); clearExpiry(); refresh.hidden = false;
    requestButton.textContent = 'Request review'; requestButton.onclick = null;
    refresh.disabled = true;
    show('Loading reviewed handoffs.',
      'Proposal identities, evidence, links, and history stay cleared until current owner authority is verified.', 'loading');
    var token = generation;
    try {
      var data = await request('/api/v1/forecast/handoffs');
      if (token !== generation) return; render(data);
    } catch (error) {
      if (token !== generation) return; clear();
      show(error.status === 401 ? 'Sign in required' : error.status === 403 ?
        'Access restricted' : 'Reviewed handoffs unavailable',
      error.status === 401 || error.status === 403 ?
        'Only a current paid-workspace owner or administrator can review forecast handoffs.' :
        'NorthStar could not verify review authority. Refresh to recover; proposal identities and history remain cleared.', 'unavailable');
    } finally { if (token === generation) refresh.disabled = false; }
  }
  async function requestReview() {
    if (global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true) return;
    if (!candidate || requestButton.disabled) return;
    var body = { runId: candidate.runId, runDigest: candidate.runDigest,
      currentnessDigest: candidate.currentness.digest,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() };
    if (!pending || JSON.stringify(pending.body) !== JSON.stringify(body)) {
      pending = { key: global.crypto.randomUUID(), body: body };
    }
    var operation = pending;
    cancel(); var token = generation;
    clearExpiry(); clear();
    show('Recording review request.', 'No receiving workflow or operational record is being changed.', 'loading');
    try {
      var result = await request('/api/v1/forecast/handoffs', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.key },
        body: JSON.stringify(operation.body) });
      if (!paidGeneration(token)) return;
      if (result.state === 'unavailable') { pending = null; unavailable(result.reason); return; }
      if (!result.proposal) throw new Error('Reviewed handoff result invalid');
      if (pending === operation) pending = null;
      await load();
    } catch (error) {
      if (!paidGeneration(token)) return;
      clearExpiry(); clear();
      show(error.status === 409 ? 'Review request changed' : 'Review request unconfirmed',
        error.status === 409 ? 'The run or currentness changed. Refresh before requesting review again.' :
          'Refresh to check immutable history before retrying the same request. No receiving action was taken.', 'unavailable');
    }
  }
  async function dismissReview(proposal, button) {
    button.disabled = true;
    var key = global.crypto.randomUUID();
    cancel(); var token = generation;
    try {
      clearExpiry(); clear();
      show('Recording review dismissal.',
        'Proposal identities and history stay cleared until the immutable dismissal is confirmed.', 'loading');
      var result = await request('/api/v1/forecast/handoffs/' + encodeURIComponent(proposal.id) + '/dismiss', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ expectedRevision: proposal.revision, expectedDigest: proposal.digest }),
      });
      if (!paidGeneration(token)) return;
      if (result.state === 'unavailable') { unavailable(result.reason); return; }
      await load();
    } catch (error) {
      if (!paidGeneration(token)) return;
      clearExpiry(); clear();
      show(error.status === 409 ? 'Review record changed' : 'Dismissal unconfirmed',
        'Refresh to check immutable review history. No receiving action was taken.', 'unavailable');
    } finally {
      if (paidGeneration(token) && button.isConnected) button.disabled = false;
    }
  }
  function demoProposal(workspace, state) {
    var digest = function (character) { return character.repeat(64); };
    var now = new Date().toISOString();
    return { version: 'm26-forecast-reviewed-handoff-v1',
      id: 'd0000000-0000-4000-8000-000000000021', state: state || 'requested',
      revision: state === 'dismissed' ? 2 : 1,
      organizationId: 'd0000000-0000-4000-8000-000000000001', createdAt: now,
      expiresAt: workspace.session.expiresAt, reviewer: { userId: 'd0000000-0000-4000-8000-000000000002', accessRole: 'owner' },
      run: { id: 'd0000000-0000-4000-8000-000000000012', digest: digest('2'),
        targetKey: 'demand.inbound_leads', targetVersion: 'v1',
        horizon: { grain: 'month', localStart: '2026-11-01' }, outputDigest: digest('3'),
        currentnessRevision: 1, currentnessDigest: digest('4') },
      recommendation: { type: 'review_demand_capacity', evidence: { predictionKind: 'point', amount: '19', unit: 'count', runDigest: digest('2'), outputDigest: digest('3') },
        uncertainty: { state: 'unquantified', drivers: ['fictional_example'] },
        missingInformation: ['calibrated_interval','current_capacity_record','exact_receiving_record'],
        tradeoff: 'Reviewing fictional capacity may expose constraints, but this example proves no real availability.' },
      receiver: { mission: '22', workflow: 'calendar_capacity_review', recordId: null,
        expectedRevision: null, expectedDigest: null, availability: 'unavailable',
        reason: 'exact_receiving_record_not_available', href: null },
      history: state === 'dismissed' ? [
        { revision: 1, action: 'requested', recordedAt: now, actorUserId: 'd0000000-0000-4000-8000-000000000002', digest: digest('5') },
        { revision: 2, action: 'dismissed', recordedAt: now, actorUserId: 'd0000000-0000-4000-8000-000000000002', digest: digest('6') },
      ] : [{ revision: 1, action: 'requested', recordedAt: now, actorUserId: 'd0000000-0000-4000-8000-000000000002', digest: digest('5') }],
      advisoryOnly: true, navigationIsApproval: false, receiverRecheckRequired: true,
      automaticActionAuthorized: false, outboundCommunicationAuthorized: false,
      proposalDigest: digest('7'), digest: state === 'dismissed' ? digest('8') : digest('9') };
  }
  function demo(workspace) {
    clearExpiry(); cancel(); clear(); pending = null; refresh.hidden = true;
    var expiresAt = workspace && workspace.session && Date.parse(workspace.session.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) { demoExpired(); return; }
    var digest = function (character) { return character.repeat(64); };
    candidate = { runId: 'd0000000-0000-4000-8000-000000000012', runDigest: digest('2'),
      targetKey: 'demand.inbound_leads', targetVersion: 'v1',
      horizon: { grain: 'month', localStart: '2026-11-01' }, outputDigest: digest('3'),
      currentness: { revision: 1, digest: digest('4') }, recommendation: {
        type: 'review_demand_capacity', summary: 'Review fictional staffing and schedule capacity for 19 inbound leads.',
        evidence: { predictionKind: 'point', amount: '19', unit: 'count', runDigest: digest('2'), outputDigest: digest('3') },
        uncertainty: { state: 'unquantified', drivers: ['fictional_example'] },
        missingInformation: ['calibrated_interval','current_capacity_record','exact_receiving_record'],
        tradeoff: 'Reviewing fictional capacity may expose constraints, but this example proves no real availability.' },
      receiver: { mission: '22', workflow: 'calendar_capacity_review', recordId: null,
        expectedRevision: null, expectedDigest: null, availability: 'unavailable',
        reason: 'exact_receiving_record_not_available', href: null }, advisoryOnly: true,
      navigationIsApproval: false, receiverRecheckRequired: true, automaticActionAuthorized: false };
    renderCandidate(candidate); renderHistory([]);
    requestButton.textContent = 'Request fictional review'; requestButton.disabled = false;
    requestButton.onclick = function () {
      var proposal = demoProposal(workspace); renderHistory([proposal], true);
      requestButton.disabled = true;
      show('Fictional review requested', 'This resettable demo stored no paid evidence and made no paid or receiving-workflow call.', 'demo');
      var dismiss = history.querySelector('button');
      if (dismiss) dismiss.onclick = function () {
        renderHistory([demoProposal(workspace, 'dismissed')], true);
        show('Fictional review dismissed', 'Only isolated demo history changed. No real action was taken.', 'demo');
      };
    };
    show('Fictional reviewed handoff',
      'This isolated example is advisory, resettable, and makes no paid or receiving-workflow calls.', 'demo');
    expiryTimer = global.setTimeout(demoExpired, Math.min(expiresAt - Date.now(), 2147483647));
  }
  function demoExpired() {
    clearExpiry(); cancel(); clear(); pending = null; refresh.hidden = true;
    show('Fictional reviewed handoff expired',
      'The fictional session expired. Proposal identities, evidence, and history were cleared. Refresh the demo to recover.', 'unavailable');
  }
  function initializeDemo() {
    clearExpiry(); cancel(); clear(); pending = null; refresh.hidden = true;
    show('Loading fictional reviewed handoff.', 'No paid forecast or receiving-workflow call will be made.', 'loading');
    if (!global.NorthStarDemoRuntime || typeof global.NorthStarDemoRuntime.loadWorkspace !== 'function') {
      demoExpired(); return;
    }
    global.NorthStarDemoRuntime.loadWorkspace(false).then(demo).catch(demoExpired);
  }

  refresh.addEventListener('click', load);
  requestButton.addEventListener('click', requestReview);
  global.addEventListener('pagehide', function () {
    clearExpiry(); cancel(); clear(); pending = null;
  });
  global.addEventListener('northstar:auth-generation', function () {
    cancel(); clear(); pending = null;
    if (global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true) initializeDemo();
    else load();
  });
  global.addEventListener('northstar:demo-workspace', function (event) {
    if (global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true &&
        event && event.detail) demo(event.detail);
  });
  if (global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true) initializeDemo();
  else load();
})(window);
