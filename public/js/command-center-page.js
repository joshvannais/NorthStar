(function (global) {
  'use strict';

  var contract = global.NorthStarCommandCenterContract;
  var mode = contract && contract.modeForPath(global.location.pathname);
  var workspace = null;
  var loading = false;
  var chartPeriod = 'daily';

  function byId(id) { return document.getElementById(id); }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function safeString(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : (fallback || '');
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatMoney(value) {
    var number = finiteNumber(value);
    if (number === null) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(number);
  }

  function formatDate(value) {
    if (!value) return null;
    var parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return null;
    return parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  function titleCase(value) {
    return safeString(value, 'unavailable').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
  }

  function destination(id) {
    return contract.destinationPath(id, mode);
  }

  function detailHref(graph, kind) {
    var selectedKind = kind || 'lead';
    var ids = graph && graph.ids || {};
    var id = selectedKind === 'customer' ? ids.customer
      : selectedKind === 'work' ? (ids.work || ids.appointment)
        : (ids.lead || ids.opportunity);
    if (!id) return destination('polaris');
    var base = mode === 'demo' ? '/demo/polaris' : '/dashboard/polaris';
    return base + '?kind=' + encodeURIComponent(selectedKind) + '&id=' + encodeURIComponent(id);
  }

  function latestGraphs() {
    return (workspace && Array.isArray(workspace.graphs) ? workspace.graphs.slice() : []).sort(function (left, right) {
      var leftTime = new Date(left && left.timestamps && left.timestamps.updatedAt || 0).getTime();
      var rightTime = new Date(right && right.timestamps && right.timestamps.updatedAt || 0).getTime();
      return rightTime - leftTime;
    });
  }

  function snapshot(graph) {
    return graph && graph.polaris && graph.polaris.snapshot && typeof graph.polaris.snapshot === 'object'
      ? graph.polaris.snapshot : {};
  }

  function actionEntries(graph) {
    var values = snapshot(graph).recommendedActions;
    return Array.isArray(values) ? values.filter(function (entry) {
      return entry && typeof entry === 'object' && safeString(entry.label);
    }) : [];
  }

  function setStatus(message, state) {
    var status = byId('commandCenterStatus');
    status.textContent = message;
    status.dataset.state = state || 'ready';
  }

  function configureMode() {
    var demo = mode === 'demo';
    byId('commandCenterHomeLink').href = demo ? '/demo' : '/dashboard';
    byId('commandCenterAuthority').textContent = demo
      ? 'Fictional data · account-free'
      : 'Tenant data · role-authorized';
    var action = byId('commandCenterHeaderAction');
    action.href = demo ? '/signup' : '/dashboard/settings';
    action.textContent = demo ? 'Start free trial' : 'Workspace settings';
    document.querySelectorAll('[data-command-destination]').forEach(function (link) {
      var href = destination(link.dataset.commandDestination);
      if (href) link.href = href;
    });
    var disclosure = byId('commandCenterDisclosure');
    disclosure.replaceChildren();
    if (demo) {
      disclosure.append(
        element('strong', '', 'This is a fictional, isolated preview.'),
        element('span', '', ' No customer, provider, production, account, or billing data is used. Every destination reads one bounded browser session.')
      );
      disclosure.hidden = false;
    } else {
      disclosure.hidden = true;
    }
  }

  function priorityScore(graph) {
    var risk = snapshot(graph).risk || {};
    if (risk.emergency === true) return 100;
    var status = safeString(graph && graph.lead && graph.lead.status).toLowerCase();
    if (status === 'hot' || status === 'needs_information') return 80;
    if (status === 'follow_up' || status === 'follow_up_due') return 70;
    if (status === 'new') return 60;
    if (status === 'qualified' || status === 'estimate_ready') return 50;
    if (status === 'booked' || status === 'scheduled') return 30;
    return 20;
  }

  function renderPriorities(graphs) {
    var list = byId('commandCenterPriorities');
    list.replaceChildren();
    var prioritized = graphs.slice().sort(function (left, right) {
      return priorityScore(right) - priorityScore(left);
    }).slice(0, 3);
    if (!prioritized.length) {
      var empty = element('li');
      empty.append(
        element('span', 'demo-priority-rank', '—'),
        element('div', '', 'No role-authorized customer or work records are available yet.'),
        element('span', 'demo-priority-badge', 'No current signal')
      );
      list.appendChild(empty);
      return;
    }
    prioritized.forEach(function (graph, index) {
      var risk = snapshot(graph).risk || {};
      var action = actionEntries(graph)[0];
      var item = element('li');
      var body = element('div');
      body.append(
        element('strong', '', safeString(graph.customer && graph.customer.name, 'Customer record') + ' · ' +
          safeString(graph.lead && graph.lead.serviceLabel, titleCase(graph.lead && graph.lead.serviceType))),
        element('p', '', action ? action.label : safeString(graph.lead && graph.lead.summary,
          'Review the current role-authorized record before taking action.'))
      );
      var badge = element('span', 'demo-priority-badge' + (risk.emergency === true ? ' demo-priority-high' : ''),
        risk.emergency === true ? 'Urgent' : titleCase(graph.lead && graph.lead.status));
      item.append(element('span', 'demo-priority-rank', String(index + 1)), body, badge);
      list.appendChild(item);
    });
  }

  function humanEvidence(graph) {
    var facts = graph && graph.polaris && Array.isArray(graph.polaris.facts) ? graph.polaris.facts : [];
    return facts.map(function (fact) { return safeString(fact && fact.evidenceText); }).filter(Boolean).slice(0, 6);
  }

  function missingInputs(graph) {
    var value = snapshot(graph);
    var result = [];
    if (Array.isArray(value.missingInformation)) {
      value.missingInformation.forEach(function (entry) {
        var text = safeString(entry && typeof entry === 'object' ? (entry.reason || entry.label) : entry);
        if (text) result.push(text);
      });
    }
    if (Array.isArray(value.notCalculated)) {
      value.notCalculated.forEach(function (entry) {
        var field = titleCase(entry && entry.field);
        var reason = safeString(entry && entry.reason);
        if (reason) result.push(field + ': ' + reason);
      });
    }
    return result;
  }

  function renderPolaris(graphs) {
    var container = byId('commandCenterPolaris');
    var graph = graphs[0];
    if (!global.NorthStarPolarisCard) {
      container.replaceChildren(element('p', '', 'Polaris intelligence is unavailable because the shared card component did not load.'));
      return;
    }
    if (!graph) {
      global.NorthStarPolarisCard.render(container, {
        contract: global.NorthStarPolarisCard.CONTRACT,
        surface: 'command-center',
        detailed: true,
        title: 'No current record to prioritize',
        summary: 'Polaris needs a role-authorized customer, lead, or work record before it can prioritize the day.',
        confidenceExplanation: 'Confidence cannot be calculated without a supporting record.',
        evidence: [],
        missing: ['A customer, lead, communication, work item, and supporting scope are not yet available.'],
        risks: [], opportunities: [], recommendations: [], objects: [],
      });
      return;
    }
    var value = snapshot(graph);
    var confidence = finiteNumber(value.confidence && value.confidence.score);
    var risk = value.risk || {};
    var customer = safeString(graph.customer && graph.customer.name, 'Current customer');
    var service = safeString(graph.lead && graph.lead.serviceLabel, titleCase(graph.lead && graph.lead.serviceType));
    var recommendations = actionEntries(graph).map(function (entry) {
      return { label: entry.label, priority: safeString(entry.priority), href: detailHref(graph) };
    });
    var risks = [];
    if (risk.emergency === true) risks.push(safeString(risk.evidence, 'An emergency signal requires immediate review.'));
    else if (safeString(risk.signal)) risks.push('Current risk signal: ' + safeString(risk.signal) + '.');
    var opportunities = [];
    if (graph.work && graph.work.scheduledStart) opportunities.push('A scheduled work window is already present for coordinated follow-through.');
    if (finiteNumber(graph.estimate && graph.estimate.customerPrice) !== null) opportunities.push('A recorded customer-facing estimate is available for review.');
    global.NorthStarPolarisCard.render(container, {
      contract: global.NorthStarPolarisCard.CONTRACT,
      surface: 'command-center',
      detailed: true,
      title: customer + ' · ' + service,
      summary: safeString(graph.lead && graph.lead.summary, 'The latest role-authorized record is ready for operational review.'),
      confidence: confidence,
      confidenceExplanation: confidence === null
        ? 'No supported confidence score is present in the current Polaris snapshot.'
        : 'Calculated from the supporting scope and evidence recorded with this Polaris snapshot.',
      evidence: humanEvidence(graph),
      missing: missingInputs(graph),
      risks: risks,
      opportunities: opportunities,
      recommendations: recommendations,
      objects: [
        { label: 'Open ' + customer + ' customer detail', href: detailHref(graph, 'customer') },
        { label: 'Open ' + service + ' lead detail', href: detailHref(graph, 'lead') },
        { label: 'Open ' + service + ' work detail', href: detailHref(graph, 'work') },
        { label: 'Review all leads', href: destination('leads') },
      ],
    });
  }

  function kpiCard(label, value, note) {
    var card = element('article', 'demo-kpi-card');
    card.append(element('span', '', label), element('strong', '', value), element('small', '', note));
    return card;
  }

  function renderKpis(graphs) {
    var grid = byId('commandCenterKpis');
    grid.replaceChildren();
    var scheduled = graphs.filter(function (graph) { return Boolean(graph.work && graph.work.scheduledStart); }).length;
    var attention = graphs.filter(function (graph) { return priorityScore(graph) >= 60; }).length;
    var values = graphs.map(function (graph) { return finiteNumber(graph.estimate && graph.estimate.customerPrice); }).filter(function (value) { return value !== null; });
    var total = values.reduce(function (sum, value) { return sum + value; }, 0);
    grid.append(
      kpiCard('Canonical records', String(graphs.length), graphs.length ? 'Customer, lead, work, and Polaris graphs in this workspace.' : 'No role-authorized graphs are available.'),
      kpiCard('Needs attention', String(attention), attention ? 'Records with urgency, missing inputs, or follow-up state.' : 'No current priority signal is supported.'),
      kpiCard('Scheduled work', String(scheduled), scheduled ? 'Work items with a recorded appointment time.' : 'No appointment time is currently recorded.'),
      kpiCard(mode === 'demo' ? 'Fictional recorded value' : 'Recorded opportunity value', values.length ? formatMoney(total) : 'Unavailable',
        values.length ? 'Sum of recorded customer-facing estimates; not recognized revenue.' : 'No role-authorized customer price is available.')
    );
  }

  function renderChart(graphs) {
    var bars = byId('commandCenterChartBars');
    var summary = byId('commandCenterChartSummary');
    bars.replaceChildren();
    summary.replaceChildren();
    var records = graphs.slice(0, 8).reverse().map(function (graph) {
      var timestamp = graph.work && graph.work.scheduledStart || graph.timestamps && graph.timestamps.createdAt;
      return { graph: graph, value: finiteNumber(graph.estimate && graph.estimate.customerPrice), date: timestamp ? new Date(timestamp) : null };
    }).filter(function (entry) { return entry.value !== null; });
    if (!records.length) {
      byId('commandCenterChart').classList.add('command-center-chart-empty');
      bars.appendChild(element('p', 'command-center-empty-copy', 'No recorded opportunity values are available for this view.'));
      summary.appendChild(element('div', '', 'The chart remains empty until a role-authorized estimate is recorded.'));
      return;
    }
    byId('commandCenterChart').classList.remove('command-center-chart-empty');
    var grouped = [];
    records.forEach(function (entry) {
      var date = entry.date && Number.isFinite(entry.date.getTime()) ? new Date(entry.date) : null;
      var key = 'undated';
      var label = safeString(entry.graph.lead && entry.graph.lead.serviceLabel, 'Work');
      if (date) {
        if (chartPeriod === 'monthly') {
          key = date.getFullYear() + '-' + date.getMonth();
          label = date.toLocaleDateString([], { month: 'short', year: 'numeric' });
        } else if (chartPeriod === 'weekly') {
          date.setHours(0, 0, 0, 0);
          date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
          key = date.toISOString().slice(0, 10);
          label = 'Week of ' + date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        } else {
          key = date.toISOString().slice(0, 10);
          label = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
      }
      var bucket = grouped.find(function (candidate) { return candidate.key === key; });
      if (!bucket) {
        bucket = { key: key, label: label, value: 0, graph: entry.graph, count: 0 };
        grouped.push(bucket);
      }
      bucket.value += entry.value;
      bucket.count += 1;
    });
    var maximum = Math.max.apply(Math, grouped.map(function (entry) { return entry.value; }));
    grouped.forEach(function (entry) {
      var item = element('div');
      var bar = element('span');
      bar.style.setProperty('--bar-height', Math.max(12, Math.round(entry.value / maximum * 86)) + '%');
      bar.title = entry.label + ': ' + formatMoney(entry.value) + ' across ' + entry.count + ' record' + (entry.count === 1 ? '' : 's');
      var button = element('button');
      button.type = 'button';
      button.setAttribute('aria-label', bar.title + '. Open complete intelligence.');
      button.addEventListener('click', function () { global.location.href = detailHref(entry.graph); });
      button.append(bar, element('small', '', entry.label));
      item.append(button);
      bars.appendChild(item);
    });
    var total = records.reduce(function (sum, entry) { return sum + entry.value; }, 0);
    var average = total / records.length;
    var totalBlock = element('div');
    totalBlock.append(element('span', '', 'Recorded total'), element('strong', '', formatMoney(total)));
    var averageBlock = element('div');
    averageBlock.append(element('span', '', 'Average record'), element('strong', '', formatMoney(average)));
    summary.append(totalBlock, averageBlock);
  }

  function renderSchedule(graphs) {
    var scheduled = graphs.filter(function (graph) { return formatDate(graph.work && graph.work.scheduledStart); })
      .sort(function (left, right) { return new Date(left.work.scheduledStart) - new Date(right.work.scheduledStart); });
    byId('commandCenterScheduleCount').textContent = scheduled.length + ' scheduled';
    var list = byId('commandCenterSchedule');
    list.replaceChildren();
    if (!scheduled.length) {
      var empty = element('li');
      empty.append(element('time', '', '—'), element('div', '', 'No role-authorized appointment time is currently recorded.'));
      list.appendChild(empty);
      return;
    }
    scheduled.slice(0, 5).forEach(function (graph) {
      var item = element('li');
      var date = formatDate(graph.work.scheduledStart);
      var copy = element('div');
      var link = element('a', 'command-center-record-link', safeString(graph.work && graph.work.title,
        safeString(graph.lead && graph.lead.serviceLabel, 'Scheduled work')));
      link.href = detailHref(graph);
      copy.append(link, element('span', '', safeString(graph.customer && graph.customer.name, 'Customer') +
        (graph.work && graph.work.assignedTo ? ' · ' + graph.work.assignedTo : ' · Assignment not recorded')));
      item.append(element('time', '', date), copy);
      list.appendChild(item);
    });
  }

  function renderLeads(graphs) {
    var rows = byId('commandCenterLeadRows');
    rows.replaceChildren();
    byId('commandCenterLeadCount').textContent = graphs.length + ' active';
    if (!graphs.length) {
      var row = document.createElement('tr');
      var cell = element('td', 'command-center-table-empty', 'No role-authorized lead records are available.');
      cell.colSpan = 5;
      row.appendChild(cell);
      rows.appendChild(row);
      return;
    }
    graphs.slice(0, 8).forEach(function (graph) {
      var row = document.createElement('tr');
      var customerCell = document.createElement('td');
      var link = element('a', 'command-center-record-link', safeString(graph.customer && graph.customer.name, 'Customer record'));
      link.href = detailHref(graph);
      customerCell.append(link, element('span', '', formatDate(graph.timestamps && graph.timestamps.createdAt) || 'Recorded time unavailable'));
      var serviceCell = element('td', '', safeString(graph.lead && graph.lead.serviceLabel, titleCase(graph.lead && graph.lead.serviceType)));
      var recorded = formatMoney(graph.estimate && graph.estimate.customerPrice);
      var valueCell = element('td', '', recorded || 'Unavailable — no recorded estimate');
      var statusCell = document.createElement('td');
      statusCell.appendChild(element('span', 'demo-status', titleCase(graph.lead && graph.lead.status)));
      var action = actionEntries(graph)[0];
      var actionCell = element('td', '', action ? action.label : 'Review complete Polaris detail');
      row.append(customerCell, serviceCell, valueCell, statusCell, actionCell);
      rows.appendChild(row);
    });
  }

  function renderCoachAndStatus(graphs) {
    var first = graphs[0];
    var action = first && actionEntries(first)[0];
    byId('commandCenterCoach').textContent = action
      ? action.label + ' The recommendation is tied to the latest recorded evidence and should be reviewed before action.'
      : 'No prioritized recommendation is available until a role-authorized customer, lead, or work record supplies enough evidence.';
    byId('commandCenterWorkspaceStatus').textContent = mode === 'demo'
      ? 'Isolated demo workspace is current'
      : 'Tenant workspace is current';
    byId('commandCenterWorkspaceNote').textContent = mode === 'demo'
      ? 'The fictional session is isolated from production, provider, account, and billing data.'
      : 'This view contains role-authorized tenant projections only; provider readiness is not inferred.';
    byId('commandCenterStatePill').replaceChildren(element('i'));
    byId('commandCenterStatePill').appendChild(document.createTextNode(mode === 'demo' ? 'Session ready' : 'Workspace ready'));
  }

  function renderCta() {
    var kicker = byId('commandCenterCtaKicker');
    var title = byId('commandCenterCtaTitle');
    var actions = byId('commandCenterCtaActions');
    actions.replaceChildren();
    if (mode === 'demo') {
      kicker.textContent = 'Ready to use your own business data?';
      title.textContent = 'Build a NorthStar workspace around the way your company actually operates.';
      var trial = element('a', 'btn btn-primary', 'Start free trial');
      trial.href = '/signup';
      var home = element('a', 'btn btn-secondary', 'Return home');
      home.href = '/';
      actions.append(trial, home);
    } else {
      kicker.textContent = 'Continue operating';
      title.textContent = 'Move from the daily view into the role-authorized record that needs attention.';
      var leads = element('a', 'btn btn-primary', 'Review leads');
      leads.href = destination('leads');
      var calendar = element('a', 'btn btn-secondary', 'Open calendar');
      calendar.href = destination('calendar');
      actions.append(leads, calendar);
    }
  }

  function render() {
    var graphs = latestGraphs();
    byId('commandCenterUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    renderPriorities(graphs);
    renderPolaris(graphs);
    renderKpis(graphs);
    renderChart(graphs);
    renderSchedule(graphs);
    renderLeads(graphs);
    renderCoachAndStatus(graphs);
    renderCta();
    byId('commandCenterContent').setAttribute('aria-busy', 'false');
    setStatus(mode === 'demo'
      ? 'The isolated workspace is ready. Simulate Lead updates this view and every demo destination.'
      : 'The current tenant workspace is ready.', 'ready');
  }

  function load() {
    if (loading) return Promise.resolve(null);
    if (!contract || !contract.routeForPath(global.location.pathname) || !global.NorthStarAccountSession) {
      setStatus('The shared Command Center contract is unavailable.', 'error');
      return Promise.resolve(null);
    }
    loading = true;
    byId('commandCenterRefresh').disabled = true;
    byId('commandCenterContent').setAttribute('aria-busy', 'true');
    setStatus('Loading the role-authorized workspace…', 'pending');
    return global.NorthStarAccountSession.fetch('/api/v1/command-center/workspace', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (payload) {
        if (!response.ok || !payload || payload.success !== true || !payload.data) {
          throw new Error(payload && payload.error && payload.error.message || 'The Command Center workspace is unavailable.');
        }
        workspace = contract.validateWorkspace(payload.data, mode);
        render();
      });
    }).catch(function (error) {
      workspace = null;
      byId('commandCenterContent').setAttribute('aria-busy', 'false');
      setStatus(error && error.message ? error.message : 'The Command Center workspace is unavailable.', 'error');
    }).finally(function () {
      loading = false;
      byId('commandCenterRefresh').disabled = false;
    });
  }

  configureMode();
  byId('commandCenterRefresh').addEventListener('click', load);
  document.querySelectorAll('[data-chart-period]').forEach(function (button) {
    button.addEventListener('click', function () {
      chartPeriod = button.dataset.chartPeriod;
      document.querySelectorAll('[data-chart-period]').forEach(function (option) {
        option.setAttribute('aria-pressed', option === button ? 'true' : 'false');
      });
      if (workspace) renderChart(latestGraphs());
    });
  });
  global.addEventListener('northstar:demo-workspace', function (event) {
    if (mode !== 'demo' || !event.detail) return;
    try {
      workspace = contract.validateWorkspace(event.detail, 'demo');
      render();
    } catch (_error) {}
  });
  load();
})(window);
