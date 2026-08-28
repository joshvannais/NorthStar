(function (global) {
  'use strict';

  var contract = global.NorthStarCommandCenterContract;
  var mode = contract && contract.modeForPath(global.location.pathname);
  var workspace = null;
  var loading = false;
  var chartPeriod = 'daily';
  var schedulingCategory = 'atRisk';
  var schedulingCursor = null;

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

  function markupLike(value) {
    if (typeof value !== 'string') return false;
    return /<\s*\/?\s*[a-z][^>]*>/i.test(value) ||
      /&lt;\s*\/?\s*[a-z][\s\S]*?&gt;/i.test(value) ||
      /(?:^|[\s"'])on[a-z]+\s*=\s*/i.test(value) ||
      /(?:javascript\s*:|data\s*:\s*text\/html)/i.test(value);
  }

  function presentationString(value, fallback) {
    var text = safeString(value, fallback);
    return markupLike(text) ? (fallback || '') : text;
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

  function tenantTimeZone() {
    var timeZone = workspace && workspace.schedulingOverview && workspace.schedulingOverview.timeZone;
    if (typeof timeZone === 'string' && timeZone) return timeZone;
    return mode === 'demo' ? 'UTC' : null;
  }

  function formatDate(value, suppliedTimeZone) {
    if (!value) return null;
    var parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return null;
    var timeZone = suppliedTimeZone || tenantTimeZone();
    if (!timeZone) return null;
    try {
      return parsed.toLocaleString([], { timeZone: timeZone, dateStyle: 'medium', timeStyle: 'short' }) +
        ' (' + timeZone + ')';
    } catch (_error) { return null; }
  }

  function tenantCalendarDate(value) {
    var parsed = new Date(value);
    var timeZone = tenantTimeZone();
    if (!Number.isFinite(parsed.getTime()) || !timeZone) return null;
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      }).formatToParts(parsed).reduce(function (result, part) {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
      }, {});
      return {
        year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
        weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
      };
    } catch (_error) { return null; }
  }

  function tenantChartBucket(value, period) {
    var parts = tenantCalendarDate(value);
    if (!parts || parts.weekday < 0) return null;
    var timeZone = tenantTimeZone();
    var localCalendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (period === 'monthly') {
      return {
        key: parts.year + '-' + String(parts.month).padStart(2, '0'),
        label: localCalendarDate.toLocaleDateString([], { timeZone: 'UTC', month: 'short', year: 'numeric' }) + ' (' + timeZone + ')',
      };
    }
    if (period === 'weekly') {
      localCalendarDate.setUTCDate(localCalendarDate.getUTCDate() - ((parts.weekday + 6) % 7));
      return {
        key: localCalendarDate.toISOString().slice(0, 10),
        label: 'Week of ' + localCalendarDate.toLocaleDateString([], { timeZone: 'UTC', month: 'short', day: 'numeric' }) + ' (' + timeZone + ')',
      };
    }
    return {
      key: [parts.year, String(parts.month).padStart(2, '0'), String(parts.day).padStart(2, '0')].join('-'),
      label: localCalendarDate.toLocaleDateString([], { timeZone: 'UTC', month: 'short', day: 'numeric' }) + ' (' + timeZone + ')',
    };
  }

  function titleCase(value) {
    return presentationString(value, 'unavailable').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (letter) {
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
    status.textContent = message || '';
    status.dataset.state = state || 'ready';
    status.hidden = !message;
  }

  function configureMode() {
    var demo = mode === 'demo';
    byId('commandCenterHomeLink').href = demo ? '/demo' : '/dashboard';
    byId('commandCenterAuthority').textContent = demo
      ? 'Demo data · account-free'
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
        element('strong', '', 'This is an isolated account-free preview.'),
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
        element('strong', '', presentationString(graph.customer && graph.customer.name, 'Customer name unavailable') + ' · ' +
          presentationString(graph.lead && graph.lead.serviceLabel, titleCase(graph.lead && graph.lead.serviceType))),
        element('p', '', action ? presentationString(action.label, 'Recommendation unavailable') : presentationString(graph.lead && graph.lead.summary,
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
    return facts.map(function (fact) { return presentationString(fact && fact.evidenceText, ''); }).filter(Boolean).slice(0, 6);
  }

  function missingInputs(graph) {
    var value = snapshot(graph);
    var result = [];
    if (Array.isArray(value.missingInformation)) {
      value.missingInformation.forEach(function (entry) {
        var text = presentationString(entry && typeof entry === 'object' ? (entry.reason || entry.label) : entry, '');
        if (text) result.push(text);
      });
    }
    if (Array.isArray(value.notCalculated)) {
      value.notCalculated.forEach(function (entry) {
        var field = titleCase(entry && entry.field);
        var reason = presentationString(entry && entry.reason, '');
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
    var customer = presentationString(graph.customer && graph.customer.name, 'Customer name unavailable');
    var service = presentationString(graph.lead && graph.lead.serviceLabel, titleCase(graph.lead && graph.lead.serviceType));
    var recommendations = actionEntries(graph).map(function (entry) {
      return { label: presentationString(entry.label, 'Recommendation unavailable'), priority: safeString(entry.priority), href: detailHref(graph) };
    });
    var risks = [];
    if (risk.emergency === true) risks.push(presentationString(risk.evidence, 'An emergency signal requires immediate review.'));
    else if (presentationString(risk.signal, '')) risks.push('Current risk signal: ' + presentationString(risk.signal, 'Risk detail unavailable') + '.');
    var opportunities = [];
    if (graph.work && graph.work.scheduledStart) opportunities.push('A scheduled work window is already present for coordinated follow-through.');
    if (finiteNumber(graph.estimate && graph.estimate.customerPrice) !== null) opportunities.push('A recorded customer-facing estimate is available for review.');
    global.NorthStarPolarisCard.render(container, {
      contract: global.NorthStarPolarisCard.CONTRACT,
      surface: 'command-center',
      detailed: true,
      title: customer + ' · ' + service,
      summary: presentationString(graph.lead && graph.lead.summary, 'The latest role-authorized record is ready for operational review.'),
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
      kpiCard('Connected records', String(graphs.length), graphs.length ? 'Customer, lead, work, and Polaris records in this workspace.' : 'No role-authorized records are available.'),
      kpiCard('Needs attention', String(attention), attention ? 'Records with urgency, missing inputs, or follow-up state.' : 'No current priority signal is supported.'),
      kpiCard('Scheduled work', String(scheduled), scheduled ? 'Work items with a recorded appointment time.' : 'No appointment time is currently recorded.'),
      kpiCard(mode === 'demo' ? 'Recorded demo value' : 'Recorded opportunity value', values.length ? formatMoney(total) : 'Unavailable',
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
        var bucketAuthority = tenantChartBucket(date, chartPeriod);
        if (bucketAuthority) { key = bucketAuthority.key; label = bucketAuthority.label; }
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
    var canonicalRecords = mode === 'paid' && workspace && workspace.schedulingOverview && Array.isArray(workspace.schedulingOverview.records)
      ? workspace.schedulingOverview.records : null;
    var scheduled = canonicalRecords
      ? canonicalRecords.filter(function (record) { return record.authority && record.authority.scheduleState === 'scheduled'; })
        .sort(function (left, right) { return new Date(left.authority.scheduledStart) - new Date(right.authority.scheduledStart); })
      : graphs.filter(function (graph) { return formatDate(graph.work && graph.work.scheduledStart); })
        .sort(function (left, right) { return new Date(left.work.scheduledStart) - new Date(right.work.scheduledStart); });
    byId('commandCenterScheduleCount').textContent = scheduled.length + ' scheduled shown';
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
      var isCanonical = Boolean(graph && graph.authority);
      var date = formatDate(isCanonical ? graph.authority.scheduledStart : graph.work.scheduledStart,
        canonicalRecords && workspace.schedulingOverview.timeZone);
      var copy = element('div');
      var link = element('a', 'command-center-record-link', presentationString(graph.work && graph.work.title,
        presentationString(graph.lead && graph.lead.serviceLabel, 'Job title unavailable')));
      var linkedGraph = isCanonical ? graphs.find(function (candidate) { return candidate.ids && candidate.ids.appointment === graph.appointmentId; }) : graph;
      link.href = linkedGraph ? detailHref(linkedGraph) : destination('calendar');
      var assignment = isCanonical ? titleCase(graph.authority.targetState) : graph.work && graph.work.assignedTo;
      copy.append(link, element('span', '', presentationString(graph.customer && graph.customer.name, 'Customer name unavailable') +
        (assignment ? ' · ' + assignment : ' · Assignment unavailable')));
      var time = element('time', '', date);
      time.dateTime = isCanonical ? graph.authority.scheduledStart : graph.work.scheduledStart;
      time.title = date;
      item.append(time, copy);
      list.appendChild(item);
    });
  }

  function schedulingStateItem(labelText, state) {
    var item = element('div', 'm22-state-item');
    item.dataset.state = state;
    item.append(element('dt', '', labelText), element('dd', '', titleCase(state)));
    return item;
  }

  function schedulingAttentionChip(state) {
    var chip = element('li', 'm22-state-chip', titleCase(state));
    chip.dataset.state = state;
    return chip;
  }

  function renderSchedulingOverview() {
    var section = byId('commandCenterScheduling');
    var categories = byId('commandCenterSchedulingCategories');
    var records = byId('commandCenterSchedulingRecords');
    var definition = byId('commandCenterSchedulingDefinition');
    section.setAttribute('aria-busy', 'false');
    categories.replaceChildren();
    records.replaceChildren();
    if (mode === 'demo') {
      definition.textContent = 'This isolated demo presentation is non-authoritative and read-only. It never reads or mutates paid tenant scheduling data.';
      records.appendChild(element('li', 'm22-overview-empty', 'Canonical owner and dispatcher scheduling actions are available only inside an authorized paid tenant workspace.'));
      return;
    }
    var overview = workspace && workspace.schedulingOverview;
    var operator = workspace && workspace.schedulingOperator;
    if (!overview || !operator || operator.canRead !== true) {
      definition.textContent = 'Current owner or active-dispatcher scheduling authority is unavailable. No mutation control is shown.';
      records.appendChild(element('li', 'm22-overview-empty', 'Refresh after verifying the current session, role, membership, onboarding, and subscription state.'));
      return;
    }
    var categoryNames = ['all', 'unassigned', 'due', 'overdue', 'atRisk', 'conflicting'];
    if (!categoryNames.includes(schedulingCategory)) schedulingCategory = 'atRisk';
    var page = overview.page || { shown: overview.records.length, total: overview.records.length };
    definition.textContent = 'Showing ' + page.shown + ' of ' + page.total + ' appointments in ' + overview.timeZone + '. ' + (schedulingCategory === 'all'
      ? 'All appointments. Categories may overlap and are classified only by the server.'
      : overview.definitions[schedulingCategory]);
    categoryNames.forEach(function (name) {
      var count = name === 'all' ? overview.total : overview.counts[name];
      var button = element('button', 'm22-category-button');
      button.append(element('span', 'm22-category-label', titleCase(name)), element('span', 'm22-category-count', count));
      button.type = 'button'; button.setAttribute('aria-pressed', name === schedulingCategory ? 'true' : 'false');
      button.addEventListener('click', function () { schedulingCategory = name; renderSchedulingOverview(); });
      categories.appendChild(button);
    });
    if (page.cursor) {
      var firstPage = element('button', 'm22-category-button', 'First page');
      firstPage.type = 'button';
      firstPage.addEventListener('click', function () { schedulingCursor = null; load(); });
      categories.appendChild(firstPage);
    }
    if (page.nextCursor) {
      var nextPage = element('button', 'm22-category-button', 'Next ' + page.size + ' appointments');
      nextPage.type = 'button';
      nextPage.addEventListener('click', function () { schedulingCursor = page.nextCursor; load(); });
      categories.appendChild(nextPage);
    }
    var selectedIds = schedulingCategory === 'all' ? null : new Set(overview.categories[schedulingCategory] || []);
    var selected = overview.records.filter(function (record) { return !selectedIds || selectedIds.has(record.appointmentId); });
    selected.forEach(function (record) {
      var item = element('li', 'm22-overview-record');
      item.dataset.appointmentId = record.appointmentId;
      var summary = element('div', 'm22-record-summary');
      summary.append(element('h3', '', presentationString(record.customer && record.customer.name, 'Customer name unavailable') + ' · ' + presentationString(record.work && record.work.title, 'Job title unavailable')),
        element('p', 'm22-record-time', formatDate(record.authority.scheduledStart, overview.timeZone) || 'Unscheduled in ' + overview.timeZone));
      var states = element('dl', 'm22-state-summary');
      states.append(
        schedulingStateItem('Assignment', record.authority.targetState),
        schedulingStateItem('Schedule', record.authority.scheduleState),
        schedulingStateItem('Dispatch', record.authority.dispatchState)
      );
      var attention = [];
      if (record.authority.needsReview === true || record.conflict && record.conflict.needsReview === true) attention.push('needs_review');
      if (record.flags && record.flags.due === true) attention.push('due');
      if (record.flags && record.flags.overdue === true) attention.push('overdue');
      if (record.flags && record.flags.atRisk === true) attention.push('at_risk');
      if (record.flags && record.flags.conflicting === true) attention.push('conflicting');
      var uniqueAttention = Array.from(new Set(attention));
      var attentionList = element('ul', 'm22-state-list');
      uniqueAttention.forEach(function (state) { attentionList.appendChild(schedulingAttentionChip(state)); });
      var status = element('div', 'm22-record-status');
      status.appendChild(states);
      if (uniqueAttention.length) status.appendChild(attentionList);
      item.append(summary, status);
      if (record.conflict && record.conflict.hardConflicts && record.conflict.hardConflicts.length) {
        item.appendChild(element('p', 'm22-hard-block', record.conflict.hardConflicts.length + ' hard conflict' + (record.conflict.hardConflicts.length === 1 ? '' : 's') + '. No override is available.'));
      }
      var actions = element('div', 'm22-record-actions');
      (operator.canMutate ? record.allowedActions || [] : []).forEach(function (action) {
        var button = element('button', 'm22-action-button', titleCase(action)); button.type = 'button';
        button.addEventListener('click', function () {
          global.NorthStarSchedulingApproval.open({
            record: record, directory: operator, action: action, timeZone: overview.timeZone,
            returnFocus: button, source: 'Command Center canonical overview', onApplied: load,
          });
        });
        actions.appendChild(button);
      });
      if (!operator.canMutate) actions.appendChild(element('p', 'm22-overview-read-only',
        'Read-only: ' + titleCase(operator.reason) + '. Preview and approval controls are unavailable.'));
      item.appendChild(actions); records.appendChild(item);
    });
    if (!selected.length) records.appendChild(element('li', 'm22-overview-empty',
      'No appointments from this bounded page are in the server-defined category; the complete category count remains shown above.'));
  }

  function renderLeads(graphs) {
    var rows = byId('commandCenterLeadRows');
    var mobileCards = byId('commandCenterLeadCards');
    rows.replaceChildren();
    mobileCards.replaceChildren();
    byId('commandCenterLeadCount').textContent = graphs.length + (graphs.length === 1 ? ' active lead' : ' active leads');
    if (!graphs.length) {
      var row = document.createElement('tr');
      var cell = element('td', 'command-center-table-empty', 'No role-authorized lead records are available.');
      cell.colSpan = 5;
      row.appendChild(cell);
      rows.appendChild(row);
      mobileCards.appendChild(element('p', 'command-center-mobile-empty', 'No role-authorized lead records are available.'));
      return;
    }
    var visible = graphs.slice(0, 8);
    var groups = [];
    var groupByCustomer = new Map();
    visible.forEach(function(graph) {
      var key = safeString(graph.ids && graph.ids.customer, safeString(graph.customer && graph.customer.name, 'Customer'));
      var group = groupByCustomer.get(key);
      if (!group) {
        group = { key: key, records: [] };
        groupByCustomer.set(key, group);
        groups.push(group);
      }
      group.records.push(graph);
    });
    groups.forEach(function(group) {
      group.records.forEach(function (graph, index) {
      var row = document.createElement('tr');
      if (index === 0) {
        var customerCell = document.createElement('td');
        customerCell.className = 'command-center-customer-group';
        customerCell.rowSpan = group.records.length;
        var link = element('a', 'command-center-record-link', presentationString(graph.customer && graph.customer.name, 'Customer name unavailable'));
        link.href = detailHref(graph);
        customerCell.appendChild(link);
        customerCell.appendChild(element('span', 'command-center-customer-record-count', group.records.length + (group.records.length === 1 ? ' work record' : ' work records')));
        var recordedAt = formatDate(graph.timestamps && graph.timestamps.createdAt);
        if (recordedAt) customerCell.appendChild(element('span', 'command-center-customer-recorded-at', recordedAt));
        row.appendChild(customerCell);
      }
      var serviceCell = element('td', '', presentationString(graph.lead && graph.lead.serviceLabel, titleCase(graph.lead && graph.lead.serviceType)));
      var recorded = formatMoney(graph.estimate && graph.estimate.customerPrice);
      var valueCell = element('td', '', recorded || 'Unavailable — no recorded estimate');
      var statusCell = document.createElement('td');
      statusCell.appendChild(element('span', 'demo-status', titleCase(graph.lead && graph.lead.status)));
      var action = actionEntries(graph)[0];
      var actionCell = element('td', '', action ? presentationString(action.label, 'Recommendation unavailable') : 'Review complete Polaris detail');
      row.append(serviceCell, valueCell, statusCell, actionCell);
      rows.appendChild(row);
      });

      var firstGraph = group.records[0];
      var customerCard = element('article', 'command-center-mobile-customer');
      var customerHeader = element('header', 'command-center-mobile-customer-header');
      var customerLink = element('a', 'command-center-record-link', presentationString(firstGraph.customer && firstGraph.customer.name, 'Customer name unavailable'));
      customerLink.href = detailHref(firstGraph);
      customerHeader.append(
        customerLink,
        element('span', 'command-center-customer-record-count', group.records.length + (group.records.length === 1 ? ' work record' : ' work records'))
      );
      var groupRecordedAt = formatDate(firstGraph.timestamps && firstGraph.timestamps.createdAt);
      if (groupRecordedAt) customerHeader.appendChild(element('span', 'command-center-customer-recorded-at', groupRecordedAt));
      var workList = element('ol', 'command-center-mobile-work-list');
      group.records.forEach(function (graph) {
        var workItem = element('li', 'command-center-mobile-work');
        var mobileService = presentationString(graph.lead && graph.lead.serviceLabel, titleCase(graph.lead && graph.lead.serviceType));
        var mobileRecorded = formatMoney(graph.estimate && graph.estimate.customerPrice) || 'Unavailable — no recorded estimate';
        var mobileStatus = titleCase(graph.lead && graph.lead.status);
        var mobileAction = actionEntries(graph)[0];
        var details = element('dl', 'command-center-mobile-work-details');
        details.append(
          element('dt', '', 'Recorded Value'), element('dd', '', mobileRecorded),
          element('dt', '', 'Status'), element('dd', '', mobileStatus),
          element('dt', '', 'Next Action'), element('dd', '', mobileAction ? presentationString(mobileAction.label, 'Recommendation unavailable') : 'Review complete Polaris detail')
        );
        workItem.append(element('h3', '', mobileService), details);
        workList.appendChild(workItem);
      });
      customerCard.append(customerHeader, workList);
      mobileCards.appendChild(customerCard);
    });
  }

  function renderCoachAndStatus(graphs) {
    var first = graphs[0];
    var action = first && actionEntries(first)[0];
    byId('commandCenterCoach').textContent = action
      ? presentationString(action.label, 'Recommendation unavailable') + ' The recommendation is tied to the latest recorded evidence and should be reviewed before action.'
      : 'No prioritized recommendation is available until a role-authorized customer, lead, or work record supplies enough evidence.';
    byId('commandCenterWorkspaceStatus').textContent = mode === 'demo'
      ? 'Isolated demo workspace is current'
      : 'Tenant workspace is current';
    byId('commandCenterWorkspaceNote').textContent = mode === 'demo'
      ? 'The demo session is isolated from production, provider, account, and billing data.'
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
    byId('commandCenterUpdated').textContent = 'Updated ' + (formatDate(new Date()) || 'time unavailable');
    renderPriorities(graphs);
    renderPolaris(graphs);
    renderKpis(graphs);
    renderChart(graphs);
    renderSchedule(graphs);
    renderSchedulingOverview();
    renderLeads(graphs);
    renderCoachAndStatus(graphs);
    renderCta();
    byId('commandCenterContent').setAttribute('aria-busy', 'false');
    setStatus(mode === 'demo'
      ? 'The isolated workspace is ready. Simulate Lead updates this view and every demo destination.'
      : '', 'ready');
  }

  function load(expected) {
    if (loading) return Promise.resolve(null);
    if (!contract || !contract.routeForPath(global.location.pathname) || !global.NorthStarAccountSession) {
      setStatus('The shared Command Center contract is unavailable.', 'error');
      return Promise.resolve(null);
    }
    loading = true;
    byId('commandCenterRefresh').disabled = true;
    byId('commandCenterContent').setAttribute('aria-busy', 'true');
    byId('commandCenterScheduling').setAttribute('aria-busy', 'true');
    setStatus('Loading the role-authorized workspace…', 'pending');
    var endpoint = '/api/v1/command-center/workspace' + (schedulingCursor ? '?cursor=' + encodeURIComponent(schedulingCursor) : '');
    return global.NorthStarAccountSession.fetch(endpoint, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (payload) {
        if (!response.ok || !payload || payload.success !== true || !payload.data) {
          throw new Error(payload && payload.error && payload.error.message || 'The Command Center workspace is unavailable.');
        }
        workspace = contract.validateWorkspace(payload.data, mode);
        render();
        if (expected) {
          var record = workspace.schedulingOverview && (workspace.schedulingOverview.records || [])
            .find(function (candidate) { return String(candidate.appointmentId) === String(expected.appointmentId); });
          if (!record || record.authority.revision !== expected.revision || record.authority.digest !== expected.digest) {
            throw new Error('Command Center refresh did not observe the exact applied scheduling revision.');
          }
          return {
            success: true,
            appointmentId: String(record.appointmentId),
            observedRevision: record.authority.revision,
            observedDigest: record.authority.digest,
          };
        }
        return { success:true };
      });
    }).catch(function (error) {
      workspace = null;
      byId('commandCenterContent').setAttribute('aria-busy', 'false');
      renderSchedulingOverview();
      setStatus(error && error.message ? error.message : 'The Command Center workspace is unavailable.', 'error');
      if (expected) throw new Error('Command Center authoritative refresh failed; the visible scheduling overview is stale and unavailable.');
      return null;
    }).finally(function () {
      loading = false;
      byId('commandCenterRefresh').disabled = false;
    });
  }

  configureMode();
  byId('commandCenterRefresh').addEventListener('click', function () { load(); });
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
