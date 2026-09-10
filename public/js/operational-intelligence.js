(function(root) {
  'use strict';
  var VERSION = 'm23-operational-intelligence-v1', RULE = 'm23-operational-review-rules-v1';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, HASH = /^[0-9a-f]{64}$/;
  function assert(value) { if (!value) throw new Error('Operational intelligence is unavailable.'); }
  function text(value, max) { assert(typeof value === 'string' && value.length <= max); }
  function exact(value, keys) { assert(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',')); }
  function pin(value) { assert(value && UUID.test(value.id) && Number.isSafeInteger(value.revision) && value.revision > 0 && HASH.test(value.digest)); }
  function messages(value, maximum) { assert(Array.isArray(value) && value.length <= maximum); value.forEach(function(item) { exact(item, 'code,text'); text(item.code, 50); text(item.text, 600); }); }
  function validate(value, id) {
    exact(value, 'version,ruleVersion,authority,advisory,humanReviewRequired,capabilities,providerUsed,generatedAt,expiresAt,audience,audienceDigest,execution,assignment,summary,scope,confidence,uncertainty,missingInputs,conflicts,comparisons,recommendations,evidence,snapshotDigest');
    assert(value.version === VERSION && value.ruleVersion === RULE && value.authority === 'postgresql_sources' && value.advisory === true && value.humanReviewRequired === true && value.providerUsed === false);
    assert(Array.isArray(value.capabilities) && value.capabilities.length === 0 && HASH.test(value.snapshotDigest) && HASH.test(value.audienceDigest));
    assert(['owner_admin', 'current_assigned_worker'].includes(value.audience));
    pin(value.execution); assert(value.execution.id === id); pin(value.assignment);
    assert(['not_started', 'in_progress', 'paused', 'completion_pending', 'completed', 'reopened', 'cancelled'].includes(value.execution.lifecycleState));
    assert(Number.isFinite(Date.parse(value.generatedAt)) && Date.parse(value.expiresAt) - Date.parse(value.generatedAt) === 300000);
    text(value.summary, 1000); text(value.scope, 1000); text(value.uncertainty, 1000);
    exact(value.confidence, 'level,basis'); assert(value.confidence.level === 'limited'); text(value.confidence.basis, 1000);
    messages(value.missingInputs, 20); messages(value.conflicts, 20); messages(value.recommendations, 4);
    assert(Array.isArray(value.comparisons) && value.comparisons.length <= 7);
    value.comparisons.forEach(function(item) {
      text(item.title, 120); text(item.explanation, 600);
      if (item.code === 'schedule_and_labor') {
        exact(item, 'code,title,plannedWindowSeconds,reviewedLaborSeconds,comparable,explanation');
        assert(item.comparable === false);
        ['plannedWindowSeconds', 'reviewedLaborSeconds'].forEach(function(key) { assert(item[key] === null || Number.isSafeInteger(item[key]) && item[key] >= 0); });
      } else {
        exact(item, 'code,title,source,completed,total,unit,comparable,explanation');
        assert(item.code === 'reported_quantity' && item.comparable === true); pin(item.source);
        ['completed', 'total'].forEach(function(key) { assert(typeof item[key] === 'string' && /^\d{1,9}(\.\d{1,6})?$/.test(item[key])); });
        assert(['ea', 'm', 'm2', 'm3', 'ft', 'ft2', 'ft3', 'yd3', 'kg', 'lb', 'l', 'gal'].includes(item.unit));
      }
    });
    assert(Array.isArray(value.evidence) && value.evidence.length === 6);
    var domains = new Set();
    value.evidence.forEach(function(item) {
      exact(item, 'domain,visibleTotal,returned,complete,pins,sourceSetDigest');
      assert(['completion', 'labor', 'materials', 'progress', 'fieldEvidence', 'equipment'].includes(item.domain) && !domains.has(item.domain)); domains.add(item.domain);
      assert(Number.isSafeInteger(item.visibleTotal) && item.visibleTotal >= 0 && Number.isSafeInteger(item.returned) && item.returned >= 0 && item.returned <= 200 && item.visibleTotal >= item.returned);
      assert(typeof item.complete === 'boolean' && (!item.complete || item.visibleTotal === item.returned) && HASH.test(item.sourceSetDigest));
      assert(Array.isArray(item.pins) && item.pins.length === item.returned); item.pins.forEach(pin);
    });
    return value;
  }
  if (typeof module === 'object' && module.exports) { module.exports = { validate: validate }; return; }
  var generation = 0, controller = null, expiry = null, executionId = null, shell = null;
  function node(tag, className, value) { var e = document.createElement(tag); if (className) e.className = className; if (value !== undefined) e.textContent = value; return e; }
  function clear() {
    generation += 1; if (controller) controller.abort(); controller = null; clearTimeout(expiry); expiry = null;
    if (shell) { shell.remove(); shell = null; } executionId = null;
  }
  function mount(host, id) {
    clear(); if (!host || !UUID.test(id || '')) return;
    executionId = id;
    shell = node('details', 'oi-panel'); shell.id = 'operationalIntelligence';
    var summary = node('summary', 'oi-toggle');
    summary.append(node('span', 'oi-brand', 'Polaris'), node('span', 'oi-toggle-title', 'Operational intelligence'), node('span', 'oi-tag', 'Advisory'));
    var content = node('div', 'oi-content'), status = node('p', 'oi-status', 'Open to review a fresh evidence-backed summary.');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    var refresh = node('button', 'oi-refresh', 'Refresh intelligence'); refresh.type = 'button';
    var body = node('div', 'oi-body'); content.append(status, refresh, body); shell.append(summary, content); host.append(shell);
    var loaded = false;
    function list(title, items) {
      var section = node('section', 'oi-section'); section.append(node('h3', '', title));
      if (!items.length) section.append(node('p', '', 'None detected in the supported visible records.'));
      else {
        var ul = node('ul'); items.forEach(function(item) { ul.append(node('li', '', item.text)); });
        if (title === 'Missing inputs' && items.length > 3) {
          var disclosure = node('details', 'oi-missing'); disclosure.append(node('summary', '', 'Review ' + items.length + ' missing inputs'), ul); section.append(disclosure);
        } else section.append(ul);
      }
      return section;
    }
    function render(value) {
      body.replaceChildren();
      body.append(node('p', 'oi-summary', value.summary), node('p', 'oi-muted', value.scope));
      var sections = node('div', 'oi-grid');
      sections.append(list('Needs review', value.conflicts), list('Missing inputs', value.missingInputs)); body.append(sections);
      var compare = node('section', 'oi-section'); compare.append(node('h3', '', 'Plan and actual evidence'));
      value.comparisons.forEach(function(item) {
        var card = node('div', 'oi-comparison'); card.append(node('h4', '', item.title));
        if (item.code === 'schedule_and_labor') {
          var values = node('dl', 'oi-values');
          values.append(node('dt', '', 'Scheduled window'), node('dd', '', item.plannedWindowSeconds === null ? 'Unavailable' : (item.plannedWindowSeconds / 60).toLocaleString() + ' minutes'),
            node('dt', '', 'Reviewed work time'), node('dd', '', item.reviewedLaborSeconds === null ? 'Unavailable' : (item.reviewedLaborSeconds / 60).toLocaleString() + ' person-minutes'));
          card.append(values);
        } else card.append(node('p', 'oi-quantity', item.completed + ' of ' + item.total + ' ' + item.unit));
        card.append(node('p', 'oi-muted', item.explanation)); compare.append(card);
      });
      body.append(compare, list('Suggested next steps', value.recommendations));
      var evidence = node('details', 'oi-evidence'); evidence.append(node('summary', '', 'Sources, freshness and confidence'));
      evidence.append(node('p', '', 'Confidence: limited. ' + value.confidence.basis), node('p', '', value.uncertainty),
        node('p', '', 'Prepared ' + new Date(value.generatedAt).toLocaleString() + ' · Refresh after ' + new Date(value.expiresAt).toLocaleTimeString()));
      var domainNames = { labor: 'Time', materials: 'Materials', equipment: 'Equipment', fieldEvidence: 'Field evidence', progress: 'Progress and changes', completion: 'Completion decisions' };
      value.evidence.forEach(function(item) {
        evidence.append(node('p', '', domainNames[item.domain] + ' · ' + item.returned + ' of ' + item.visibleTotal + ' records included' + (item.complete ? '' : ' · some records are unavailable')));
      });
      body.append(evidence);
      body.append(node('p', 'oi-boundary', 'Advice only. You decide whether to act. Reviewing this summary does not change work, schedules or prices, approve completion, create invoices or contact customers.'));
    }
    async function load() {
      var token = ++generation, selected = executionId, started = performance.now(); if (controller) controller.abort(); clearTimeout(expiry);
      controller = new AbortController(); var own = controller, timeout = setTimeout(function() { own.abort(); }, 10000);
      body.replaceChildren(); status.textContent = 'Reading current authorized evidence…'; refresh.disabled = true; loaded = true;
      try {
        var response = await fetch('/api/v1/field-executions/' + selected + '/intelligence', { credentials: 'same-origin', cache: 'no-store', signal: own.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(response.status === 409 ? 'Your work details or access changed. Reload work before reviewing intelligence.' : 'Intelligence is unavailable or access has changed. No previous advice is retained.');
        var raw = await response.text(); assert(raw.length <= 500000); var payload = JSON.parse(raw); assert(payload.success === true);
        var data = validate(payload.data, selected); if (token !== generation) return;
        render(data); status.textContent = 'Summary ready · Review before acting';
        expiry = setTimeout(function() { if (token === generation) { body.replaceChildren(); status.textContent = 'This summary is out of date. Refresh to check the latest work records.'; loaded = false; } }, Math.max(0, 300000 - (performance.now() - started)));
      } catch (error) {
        if (token !== generation) return; body.replaceChildren(); status.textContent = navigator.onLine === false ? 'You are offline. Reconnect and refresh to review the latest work records.' : error.name === 'AbortError' ? 'The evidence request timed out. Refresh to try again.' : 'This summary could not be loaded. Refresh to check your access and the latest work records.'; loaded = false;
      } finally { clearTimeout(timeout); if (token === generation) { refresh.disabled = false; controller = null; } }
    }
    shell.addEventListener('toggle', function() { if (shell && shell.open && !loaded) load(); }); refresh.addEventListener('click', load);
  }
  root.NorthStarOperationalIntelligence = { mount: mount, clear: clear, validate: validate };
  document.addEventListener('visibilitychange', function() { if (document.hidden && shell) mount(shell.parentElement, executionId); });
  window.addEventListener('pagehide', clear);
})(typeof window === 'object' ? window : globalThis);
