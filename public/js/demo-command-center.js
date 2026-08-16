(function (global) {
  'use strict';

  var contract = global.NorthStarCommandCenterContract;
  var route = contract && contract.routeForPath(global.location.pathname);
  var workspace = null;
  var content = document.getElementById('demoCommandContent');
  var status = document.getElementById('demoCommandStatus');
  var simulateButton = document.getElementById('demoSimulateLead');
  var resetButton = document.getElementById('demoReset');
  var scenario = document.getElementById('demoScenario');

  var DESCRIPTIONS = Object.freeze({
    'command-center': 'See the daily priorities, pipeline, schedule, and customer activity driven by one shared workspace.',
    polaris: 'Open complete Polaris detail for every meaningful fictional customer, lead, and work object.',
    leads: 'Review every fictional opportunity and follow it into the same complete Polaris record graph.',
    communications: 'See the fictional interactions and transcripts that support each customer and lead.',
    'my-number': 'Preview the account surface without placing calls or claiming a provider connection.',
    calendar: 'Review work scheduled from the same fictional leads and customer records.',
    team: 'See a stable, read-only example of workforce roles and crew availability.',
    'ai-settings': 'Preview provider-neutral assistant guidance without representing provider readiness.',
    'business-profile': 'Review truthful Profile Readiness guidance in a stable, read-only sample profile.',
    settings: 'Preview notification and map-launch preferences without changing an account.',
    integrations: 'Browse the accepted, read-only integration catalogue with unavailable capabilities shown truthfully.',
  });

  function element(tag, className, text) {
    var value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined && text !== null) value.textContent = String(text);
    return value;
  }

  function append(parent) {
    for (var index = 1; index < arguments.length; index += 1) {
      var child = arguments[index];
      if (child !== null && child !== undefined) parent.appendChild(child);
    }
    return parent;
  }

  function panel(kicker, title, className) {
    var value = element('article', 'demo-panel ' + (className || ''));
    if (kicker) value.appendChild(element('p', 'demo-panel-kicker', kicker));
    if (title) value.appendChild(element('h2', '', title));
    return value;
  }

  function link(text, href, className) {
    var value = element('a', className || '', text);
    value.href = href;
    return value;
  }

  function money(value) {
    var number = Number(value);
    return Number.isFinite(number)
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(number)
      : 'Not calculated';
  }

  function dateTime(value) {
    if (!value) return 'Not scheduled';
    var parsed = new Date(value);
    return Number.isFinite(parsed.getTime())
      ? parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : 'Unavailable';
  }

  function titleCase(value) {
    return String(value || 'unavailable').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function detailHref(kind, id) {
    return '/demo/polaris?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(id);
  }

  function idempotencyKey() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    var bytes = new Uint8Array(24);
    global.crypto.getRandomValues(bytes);
    return Array.from(bytes).map(function (value) { return value.toString(16).padStart(2, '0'); }).join('');
  }

  function fetchJson(url, options) {
    var controller = new AbortController();
    var timer = global.setTimeout(function () { controller.abort(); }, 10000);
    var request = Object.assign({ credentials: 'same-origin', headers: { Accept: 'application/json' } }, options || {});
    request.signal = controller.signal;
    return global.fetch(url, request).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (payload) {
        if (!response.ok || !payload || payload.success !== true) {
          var message = payload && payload.error && payload.error.message;
          var error = new Error(message || 'The isolated demo is temporarily unavailable.');
          error.status = response.status;
          throw error;
        }
        return payload;
      });
    }).finally(function () { global.clearTimeout(timer); });
  }

  function validate(value) {
    return contract.validateWorkspace(value, 'demo');
  }

  function setBusy(busy) {
    simulateButton.disabled = busy || !workspace;
    resetButton.disabled = busy || !workspace;
    scenario.disabled = busy || !workspace;
    content.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state || 'ready';
  }

  function renderNavigation() {
    var navigation = document.getElementById('demoCommandNavigation');
    navigation.replaceChildren();
    workspace.navigation.forEach(function (destination) {
      var item = link(destination.label, destination.href, 'demo-command-nav-link');
      item.dataset.navId = destination.id;
      if (destination.id === route.id) {
        item.classList.add('active');
        item.setAttribute('aria-current', 'page');
      }
      navigation.appendChild(item);
    });
  }

  function renderHeading() {
    var title = route.label === 'Polaris' ? 'Polaris' : route.label;
    document.getElementById('demoCommandTitle').textContent = title;
    document.getElementById('demoCommandDescription').textContent = DESCRIPTIONS[route.id];
    document.getElementById('demoWorkspaceRevision').textContent = 'Revision ' + workspace.integrity.revision + ' · ' + workspace.integrity.graphCount + ' record graphs';
    document.getElementById('demoSessionDurability').textContent = workspace.session.durable
      ? 'Durable isolated session'
      : 'Projection-only until you act';
    document.title = title + ' Demo — NorthStar';
  }

  function kpi(label, value, note) {
    var card = element('article', 'demo-kpi-card');
    append(card, element('span', '', label), element('strong', '', value), element('small', '', note));
    return card;
  }

  function renderCommandCenter() {
    var fragment = document.createDocumentFragment();
    var graphs = workspace.graphs;
    var revenue = graphs.reduce(function (sum, graph) { return sum + (Number(graph.estimate.customerPrice) || 0); }, 0);
    var scheduled = graphs.filter(function (graph) { return Boolean(graph.work.scheduledStart); }).length;
    var customers = new Set(graphs.map(function (graph) { return graph.ids.customer; })).size;
    var kpis = element('section', 'demo-kpi-grid');
    kpis.setAttribute('aria-label', 'Fictional business snapshot');
    append(kpis,
      kpi('Open leads', graphs.length, 'Same canonical session'),
      kpi('Opportunity', money(revenue), 'Fictional estimate value'),
      kpi('Scheduled work', scheduled, 'Today and upcoming'),
      kpi('Customers', customers, 'Complete Polaris detail')
    );
    fragment.appendChild(kpis);

    var priorityGrid = element('section', 'demo-dashboard-priority-grid');
    var priorities = panel('Daily brief', 'What deserves attention', 'demo-daily-brief');
    var list = element('ol', 'demo-priority-list');
    graphs.slice(0, 3).forEach(function (graph, index) {
      var item = element('li');
      var body = element('div');
      append(body,
        link(graph.customer.name, detailHref('customer', graph.ids.customer), 'demo-object-link'),
        element('p', '', graph.polaris.snapshot.recommendedActions[0].label)
      );
      append(item, element('span', 'demo-priority-rank', index + 1), body, element('span', 'demo-priority-badge', titleCase(graph.lead.status)));
      list.appendChild(item);
    });
    priorities.appendChild(list);

    var best = graphs[0];
    var polaris = panel('Polaris intelligence', 'Best next move', 'demo-polaris-panel');
    polaris.appendChild(element('p', 'demo-polaris-copy', best.polaris.snapshot.recommendedActions[0].label + ' for ' + best.customer.name + '.'));
    var metrics = element('div', 'demo-polaris-metrics');
    append(metrics,
      kpi('Confidence', best.polaris.snapshot.confidence.score + '%', 'Fictional demo detail'),
      kpi('Opportunity', money(best.estimate.customerPrice), 'Preliminary sample')
    );
    append(polaris, metrics, element('p', 'demo-reasoning', best.polaris.snapshot.reasoning.join(' ')),
      link('Open complete Polaris detail', detailHref('lead', best.ids.lead), 'btn btn-secondary btn-sm'));
    append(priorityGrid, priorities, polaris);
    fragment.appendChild(priorityGrid);

    var recent = panel('Recent leads', 'Qualified conversations ready for action', 'demo-leads-panel');
    recent.appendChild(renderGraphTable(graphs));
    fragment.appendChild(recent);
    content.replaceChildren(fragment);
  }

  function renderGraphTable(graphs) {
    var wrap = element('div', 'demo-table-wrap');
    var table = element('table');
    var head = element('thead');
    var headingRow = element('tr');
    ['Customer', 'Request', 'Opportunity', 'Status', 'Polaris detail'].forEach(function (heading) {
      var cell = element('th', '', heading);
      cell.scope = 'col';
      headingRow.appendChild(cell);
    });
    head.appendChild(headingRow);
    var body = element('tbody');
    graphs.forEach(function (graph) {
      var row = element('tr');
      var customer = element('td');
      append(customer, link(graph.customer.name, detailHref('customer', graph.ids.customer), 'demo-object-link'), element('span', '', dateTime(graph.timestamps.createdAt)));
      append(row,
        customer,
        element('td', '', graph.lead.serviceLabel || titleCase(graph.lead.serviceType)),
        element('td', '', money(graph.estimate.customerPrice)),
        append(element('td'), element('span', 'demo-status', titleCase(graph.lead.status))),
        append(element('td'), link('Open lead graph', detailHref('lead', graph.ids.lead), 'demo-object-link'))
      );
      body.appendChild(row);
    });
    append(table, head, body);
    wrap.appendChild(table);
    return wrap;
  }

  function selectedGraph() {
    var query = new URLSearchParams(global.location.search);
    var kind = query.get('kind');
    var objectId = query.get('id');
    var key = { customer: 'customer', lead: 'lead', work: 'work' }[kind];
    if (!key || !objectId) return workspace.graphs[0] || null;
    return workspace.graphs.find(function (graph) { return graph.ids[key] === objectId; }) || null;
  }

  function definitionList(entries) {
    var list = element('dl', 'demo-detail-list');
    entries.forEach(function (entry) {
      append(list, element('dt', '', entry[0]), element('dd', '', entry[1]));
    });
    return list;
  }

  function renderPolaris() {
    var graph = selectedGraph();
    if (!graph) {
      content.replaceChildren(append(panel('Polaris intelligence', 'No fictional records yet'), element('p', '', 'Use Simulate Lead to add one.')));
      return;
    }
    var fragment = document.createDocumentFragment();
    var selector = panel('Record graph', 'Complete role-safe detail');
    var choices = element('div', 'demo-record-choices');
    workspace.graphs.forEach(function (item) {
      var choice = link(item.customer.name + ' · ' + item.lead.serviceLabel, detailHref('lead', item.ids.lead), 'demo-record-choice');
      if (item.ids.graph === graph.ids.graph) choice.classList.add('active');
      choices.appendChild(choice);
    });
    append(selector, choices, element('p', 'demo-detail-disclosure', 'All values below are fictional and belong only to this isolated demo session.'));
    fragment.appendChild(selector);

    var summary = element('section', 'demo-detail-grid');
    var customer = panel('Customer', graph.customer.name);
    customer.appendChild(definitionList([
      ['Customer ID', graph.ids.customer], ['Phone', graph.customer.phone], ['Email', graph.customer.email], ['Address', graph.customer.address],
    ]));
    var lead = panel('Lead', graph.lead.serviceLabel);
    lead.appendChild(definitionList([
      ['Lead ID', graph.ids.lead], ['Status', titleCase(graph.lead.status)], ['Summary', graph.lead.summary], ['Opportunity', money(graph.estimate.customerPrice)],
    ]));
    var work = panel('Work', graph.work.title);
    work.appendChild(definitionList([
      ['Work ID', graph.ids.work], ['Status', titleCase(graph.work.status)], ['Scheduled', dateTime(graph.work.scheduledStart)], ['Assigned to', graph.work.assignedTo || 'Unassigned'],
    ]));
    append(summary, customer, lead, work);
    fragment.appendChild(summary);

    var intelligence = panel('Polaris detail', graph.polaris.snapshot.recommendedActions[0].label, 'demo-polaris-detail');
    intelligence.appendChild(definitionList([
      ['Snapshot digest', graph.polaris.snapshotDigest],
      ['Calculation contract', graph.polaris.calculationVersion],
      ['Confidence', graph.polaris.snapshot.confidence.score + '%'],
      ['Estimate', money(graph.polaris.snapshot.customerFacingPrice)],
      ['Preliminary range', money(graph.polaris.snapshot.preliminaryRange.low) + '–' + money(graph.polaris.snapshot.preliminaryRange.high)],
      ['Created', dateTime(graph.timestamps.snapshotCreatedAt)],
    ]));
    var reasoning = element('ul', 'demo-detail-bullets');
    graph.polaris.snapshot.reasoning.forEach(function (item) { reasoning.appendChild(element('li', '', item)); });
    intelligence.appendChild(element('h3', '', 'Reasoning'));
    intelligence.appendChild(reasoning);
    var facts = element('div', 'demo-fact-grid');
    graph.polaris.facts.forEach(function (fact) {
      var factCard = element('article', 'demo-fact-card');
      append(factCard, element('strong', '', titleCase(fact.variable)), element('span', '', JSON.stringify(fact.normalizedValue)), element('small', '', fact.evidenceText));
      facts.appendChild(factCard);
    });
    intelligence.appendChild(element('h3', '', 'Supporting facts'));
    intelligence.appendChild(facts);
    var limitations = element('ul', 'demo-detail-bullets');
    graph.polaris.snapshot.notCalculated.forEach(function (item) { limitations.appendChild(element('li', '', item.field + ': ' + item.reason)); });
    intelligence.appendChild(element('h3', '', 'Not calculated'));
    intelligence.appendChild(limitations);
    var raw = element('details', 'demo-raw-detail');
    append(raw, element('summary', '', 'Inspect the complete fictional Polaris snapshot'), element('pre', '', JSON.stringify(graph.polaris.snapshot, null, 2)));
    intelligence.appendChild(raw);
    fragment.appendChild(intelligence);
    content.replaceChildren(fragment);
  }

  function renderLeads() {
    var value = panel('Leads', 'Fictional opportunities from one canonical session', 'demo-leads-panel');
    value.appendChild(renderGraphTable(workspace.graphs));
    content.replaceChildren(value);
  }

  function renderCommunications() {
    var grid = element('section', 'demo-list-grid');
    workspace.graphs.forEach(function (graph) {
      var value = panel('Inbound fictional call', graph.customer.name);
      value.appendChild(element('p', '', graph.communication.subject));
      var transcript = element('ol', 'demo-transcript');
      (graph.communication.transcript || []).forEach(function (turn) {
        transcript.appendChild(element('li', '', titleCase(turn.speaker || turn.role) + ': ' + (turn.text || turn.utterance || '')));
      });
      if (!transcript.children.length) transcript.appendChild(element('li', '', 'Transcript detail is not present in this seed record.'));
      append(value, transcript, link('Open customer Polaris detail', detailHref('customer', graph.ids.customer), 'demo-object-link'));
      grid.appendChild(value);
    });
    content.replaceChildren(grid);
  }

  function renderMyNumber() {
    var config = workspace.configuration.myNumber;
    var value = panel('My Number', config.displayNumber);
    append(value, element('p', '', config.status), element('p', 'demo-detail-disclosure', 'Read-only demo surface. No forwarding, call, SMS, or provider action is available.'));
    content.replaceChildren(value);
  }

  function renderCalendar() {
    var grid = element('section', 'demo-list-grid');
    workspace.graphs.forEach(function (graph) {
      var value = panel(titleCase(graph.work.status), graph.work.title);
      value.appendChild(definitionList([
        ['Customer', graph.customer.name], ['When', dateTime(graph.work.scheduledStart)], ['Assigned to', graph.work.assignedTo || 'Unassigned'],
      ]));
      value.appendChild(link('Open complete work detail', detailHref('work', graph.ids.work), 'demo-object-link'));
      grid.appendChild(value);
    });
    content.replaceChildren(grid);
  }

  function renderTeam() {
    var config = workspace.configuration.workforce;
    var value = panel('Fictional workforce', 'Roles and crews');
    var grid = element('div', 'demo-list-grid');
    config.members.forEach(function (member) {
      var card = panel(titleCase(member.accessRole), member.name);
      append(card, element('p', '', member.operationalRole), element('span', 'demo-count-pill', 'Read-only demo'));
      grid.appendChild(card);
    });
    value.appendChild(grid);
    content.replaceChildren(value);
  }

  function renderAiSettings() {
    var config = workspace.configuration.aiSettings;
    var value = panel('AI Settings', 'Provider-neutral sample guidance');
    value.appendChild(definitionList([
      ['Voice style', config.voiceStyle], ['Escalation', config.escalation], ['Provider status', config.providerConnection],
    ]));
    value.appendChild(element('p', 'demo-detail-disclosure', 'This surface is stable across Simulate Lead and does not expose provider controls.'));
    content.replaceChildren(value);
  }

  function renderBusinessProfile() {
    var config = workspace.configuration.businessProfile;
    var value = panel('Business Profile', config.company);
    append(value, element('p', '', config.readiness.guidance), element('p', 'demo-detail-disclosure', config.readiness.separation));
    value.appendChild(definitionList([
      ['Industry', config.industry], ['Service area', config.serviceArea], ['Hours', config.hours], ['Readiness', config.readiness.label],
    ]));
    var list = element('div', 'demo-readiness-list');
    config.readiness.items.forEach(function (item) {
      var row = element('div', 'demo-readiness-item');
      append(row, element('strong', '', item.label), element('span', 'demo-status', titleCase(item.state)));
      list.appendChild(row);
    });
    value.appendChild(list);
    content.replaceChildren(value);
  }

  function renderSettings() {
    var config = workspace.configuration.settings;
    var value = panel('Settings', 'Stable account-free preferences');
    value.appendChild(element('p', 'demo-detail-disclosure', config.maps.note));
    var maps = element('div', 'demo-list-grid');
    config.maps.providers.forEach(function (provider) {
      var providerConfig = config.maps.effective.providers[provider.key];
      var card = panel('Map preference', provider.name);
      card.appendChild(definitionList([
        ['Enabled', providerConfig.enabled ? 'Yes' : 'No'], ['Visible', providerConfig.visible ? 'Yes' : 'No'], ['Default', config.maps.effective.defaultProvider === provider.key ? 'Yes' : 'No'],
      ]));
      maps.appendChild(card);
    });
    value.appendChild(maps);
    content.replaceChildren(value);
  }

  function renderIntegrations() {
    var catalogue = workspace.configuration.integrations;
    var fragment = document.createDocumentFragment();
    var intro = panel('Integrations', 'Truthful read-only catalogue');
    intro.appendChild(element('p', 'demo-detail-disclosure', 'Catalogue entries do not establish a provider connection, authorization, sync, or readiness claim.'));
    fragment.appendChild(intro);
    catalogue.categories.forEach(function (category) {
      var value = panel('Catalogue category', category.label);
      var grid = element('div', 'demo-integration-grid');
      category.providers.forEach(function (provider) {
        var card = element('article', 'demo-integration-card');
        append(card, element('strong', '', provider.name), element('span', 'demo-status', provider.presentation.label), element('p', '', provider.description));
        grid.appendChild(card);
      });
      value.appendChild(grid);
      fragment.appendChild(value);
    });
    content.replaceChildren(fragment);
  }

  var RENDERERS = Object.freeze({
    'command-center': renderCommandCenter,
    polaris: renderPolaris,
    leads: renderLeads,
    communications: renderCommunications,
    'my-number': renderMyNumber,
    calendar: renderCalendar,
    team: renderTeam,
    'ai-settings': renderAiSettings,
    'business-profile': renderBusinessProfile,
    settings: renderSettings,
    integrations: renderIntegrations,
  });

  function render() {
    renderNavigation();
    renderHeading();
    RENDERERS[route.id]();
    content.setAttribute('aria-busy', 'false');
    setStatus('Demo revision ' + workspace.integrity.revision + ' is ready. All destinations share digest ' + workspace.integrity.digest.slice(0, 12) + '…', 'ready');
    setBusy(false);
  }

  function load() {
    if (!contract || !route || contract.modeForPath(global.location.pathname) !== 'demo') {
      setStatus('The demo route contract is unavailable.', 'error');
      setBusy(true);
      return;
    }
    setBusy(true);
    fetchJson('/api/demo/command-center').then(function (payload) {
      workspace = validate(payload.data);
      render();
    }).catch(function (error) {
      workspace = null;
      content.replaceChildren(append(panel('Demo unavailable', 'The isolated workspace could not load'), element('p', '', error.message)));
      setStatus(error.message, 'error');
      setBusy(true);
    });
  }

  function mutate(path, intent, body, pendingMessage) {
    if (!workspace) return;
    setBusy(true);
    setStatus(pendingMessage, 'pending');
    return fetchJson(path, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey(),
        'X-NorthStar-Demo-Intent': intent,
      },
      body: JSON.stringify(body),
    }).then(function (payload) {
      workspace = validate(payload.data);
      render();
    }).catch(function (error) {
      setStatus(error.message, 'error');
      setBusy(false);
    });
  }

  simulateButton.addEventListener('click', function () {
    mutate('/api/demo/command-center/simulations/leads', 'simulate-lead', {
      service: scenario.value,
      expectedRevision: workspace.integrity.revision,
    }, 'Committing one fictional lead graph to this isolated demo session…');
  });

  resetButton.addEventListener('click', function () {
    mutate('/api/demo/command-center/reset', 'reset', {
      expectedRevision: workspace.integrity.revision,
    }, 'Resetting only this isolated fictional demo session…');
  });

  global.NorthStarDemoCommandCenter = Object.freeze({
    load: load,
    route: route,
    getWorkspace: function () { return workspace; },
  });
  load();
})(window);
