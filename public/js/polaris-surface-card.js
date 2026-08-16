(function (global) {
  'use strict';

  var PROJECTION_CONTRACT = 'northstar_polaris_surface_projection_v1';
  var DETAILED_SURFACES = ['command-center', 'leads', 'polaris'];

  function safeString(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : (fallback || '');
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function unique(values) {
    var result = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var text = safeString(value);
      if (text && result.indexOf(text) < 0) result.push(text);
    });
    return result;
  }

  function titleCase(value) {
    return safeString(value, 'Unavailable').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
  }

  function graphs(workspace) {
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

  function evidence(graph, limit) {
    var facts = graph && graph.polaris && Array.isArray(graph.polaris.facts) ? graph.polaris.facts : [];
    return unique(facts.map(function (fact) { return safeString(fact && fact.evidenceText); })).slice(0, limit || 5);
  }

  function missing(graph) {
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
        var reason = safeString(entry && entry.reason);
        if (reason) result.push(titleCase(entry.field) + ' is unavailable: ' + reason);
      });
    }
    return unique(result);
  }

  function recommendations(graph, href) {
    var values = snapshot(graph).recommendedActions;
    if (!Array.isArray(values)) return [];
    return values.filter(function (entry) {
      return entry && typeof entry === 'object' && safeString(entry.label);
    }).slice(0, 4).map(function (entry) {
      return { label: entry.label, priority: safeString(entry.priority), href: href || '' };
    });
  }

  function transcriptTurns(graph) {
    var value = graph && graph.communication && graph.communication.transcript;
    if (Array.isArray(value)) return value.filter(function (turn) { return turn && safeString(turn.text); });
    var text = value && typeof value === 'object' ? value.text : value;
    if (typeof text !== 'string' || !text.trim()) return [];
    try {
      var parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.filter(function (turn) { return turn && safeString(turn.text); }) : [];
    } catch (_error) {
      return [{ speaker: 'record', text: text.trim() }];
    }
  }

  function detailPath(mode, kind, identifier) {
    if (!identifier) return '';
    var base = mode === 'demo' ? '/demo/polaris' : '/dashboard/polaris';
    return base + '?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(identifier);
  }

  function objectLinks(graph, mode) {
    if (!graph || !graph.ids) return [];
    var customer = safeString(graph.customer && graph.customer.name, 'Customer');
    var service = safeString(graph.lead && graph.lead.serviceLabel,
      titleCase(graph.lead && graph.lead.serviceType));
    return [
      { label: 'Open ' + customer + ' customer detail', href: detailPath(mode, 'customer', graph.ids.customer) },
      { label: 'Open ' + service + ' lead detail', href: detailPath(mode, 'lead', graph.ids.lead || graph.ids.opportunity) },
      { label: 'Open ' + service + ' work detail', href: detailPath(mode, 'work', graph.ids.work || graph.ids.appointment) },
    ].filter(function (entry) { return entry.href; });
  }

  function baseProjection(surface, workspace, graph) {
    var confidence = finiteNumber(snapshot(graph).confidence && snapshot(graph).confidence.score);
    return {
      projectionContract: PROJECTION_CONTRACT,
      contract: global.NorthStarPolarisCard.CONTRACT,
      surface: surface,
      detailed: DETAILED_SURFACES.indexOf(surface) >= 0,
      title: 'Polaris intelligence is unavailable',
      summary: 'No role-authorized projection is available for this destination.',
      confidence: confidence,
      confidenceExplanation: confidence === null
        ? 'Confidence is unavailable because no supporting Polaris score is present in the current role-authorized inputs.'
        : 'This score comes from the latest role-authorized Polaris snapshot and its supporting evidence.',
      evidence: evidence(graph, 6),
      missing: missing(graph),
      risks: [],
      opportunities: [],
      recommendations: [],
      objects: objectLinks(graph, workspace.mode),
    };
  }

  function currentGraph(workspace) {
    return graphs(workspace)[0] || null;
  }

  function riskEntries(graph) {
    var risk = snapshot(graph).risk || {};
    if (risk.emergency === true) return [safeString(risk.evidence, 'An emergency signal requires immediate review.')];
    if (safeString(risk.signal)) return ['Current risk signal: ' + safeString(risk.signal) + '.'];
    return [];
  }

  function leadProjection(workspace) {
    var values = graphs(workspace);
    var graph = values[0];
    var result = baseProjection('leads', workspace, graph);
    var attention = values.filter(function (item) {
      return ['new', 'hot', 'follow_up', 'follow_up_due', 'needs_information'].indexOf(
        safeString(item && item.lead && item.lead.status).toLowerCase()
      ) >= 0;
    }).length;
    var booked = values.filter(function (item) {
      return ['booked', 'scheduled'].indexOf(safeString(item && item.lead && item.lead.status).toLowerCase()) >= 0 ||
        Boolean(item && item.work && item.work.scheduledStart);
    }).length;
    result.title = values.length ? values.length + ' role-authorized lead records' : 'No lead records available';
    result.summary = values.length
      ? attention + ' need review or follow-up; ' + booked + ' have a recorded booking or appointment.'
      : 'Polaris cannot evaluate lead priority until a role-authorized lead graph is recorded.';
    result.risks = riskEntries(graph).concat(attention ? [attention + ' lead records currently carry an attention state.'] : []);
    result.opportunities = booked ? [booked + ' lead records have a recorded next step or appointment.'] : [];
    result.recommendations = recommendations(graph, result.objects[1] && result.objects[1].href);
    if (!result.missing.length && !values.length) result.missing = ['Customer, lead, work, and supporting evidence are not yet available.'];
    return result;
  }

  function requestedGraph(workspace) {
    var query = new URLSearchParams(global.location.search);
    var kind = query.get('kind') || (query.get('leadId') ? 'lead' : '');
    var identifier = query.get('id') || query.get('leadId');
    if (!kind || !identifier || ['customer', 'lead', 'work'].indexOf(kind) < 0) {
      return { graph: currentGraph(workspace), requested: false };
    }
    var key = kind === 'lead' ? 'lead' : kind;
    var match = graphs(workspace).find(function (graph) {
      return graph && graph.ids && (graph.ids[key] === identifier ||
        (key === 'lead' && graph.ids.opportunity === identifier) ||
        (key === 'work' && graph.ids.appointment === identifier));
    });
    return { graph: match || null, requested: true, kind: kind, identifier: identifier };
  }

  function polarisProjection(workspace) {
    var requested = requestedGraph(workspace);
    var graph = requested.graph;
    var result = baseProjection('polaris', workspace, graph);
    if (requested.requested && !graph) {
      result.title = 'Requested Polaris detail is unavailable';
      result.summary = 'The requested customer, lead, or work object was not present in this role-authorized tenant projection. No fallback object is shown.';
      result.missing = ['Confirm that the object still exists and that the signed-in role can read it.'];
      result.objects = [];
      return result;
    }
    if (!graph) {
      result.title = 'No Polaris detail is available';
      result.summary = 'Polaris needs a role-authorized customer, lead, communication, work item, and supporting facts before rendering complete detail.';
      result.missing = ['No canonical graph is present in the current workspace.'];
      return result;
    }
    var customer = safeString(graph.customer && graph.customer.name, 'Customer record');
    var service = safeString(graph.lead && graph.lead.serviceLabel, titleCase(graph.lead && graph.lead.serviceType));
    result.title = customer + ' · ' + service;
    result.summary = safeString(graph.lead && graph.lead.summary,
      'Complete role-authorized Polaris detail is available for the selected record.');
    result.risks = riskEntries(graph);
    if (graph.work && !graph.work.scheduledStart) result.risks.push('No appointment time is recorded for this work item.');
    if (graph.estimate && finiteNumber(graph.estimate.customerPrice) !== null) {
      result.opportunities.push('A recorded customer-facing estimate is available for review; it is not treated as recognized revenue.');
    }
    if (graph.work && graph.work.scheduledStart) result.opportunities.push('A scheduled work window is present for coordinated follow-through.');
    result.recommendations = recommendations(graph, result.objects[1] && result.objects[1].href);
    return result;
  }

  function communicationsProjection(workspace) {
    var values = graphs(workspace);
    var graph = values[0];
    var result = baseProjection('communications', workspace, graph);
    var withConversation = values.filter(function (item) { return transcriptTurns(item).length > 0; }).length;
    var followUp = values.filter(function (item) {
      return ['follow_up', 'follow_up_due', 'needs_information'].indexOf(
        safeString(item && item.lead && item.lead.status).toLowerCase()
      ) >= 0;
    }).length;
    var intents = unique(values.map(function (item) {
      return safeString(item && item.communication && item.communication.intent) ||
        safeString(item && item.lead && item.lead.callerIntent);
    }));
    result.title = 'Conversation and follow-up intelligence';
    result.summary = values.length
      ? withConversation + ' of ' + values.length + ' role-authorized records include conversation evidence; ' + followUp + ' need follow-up or more information.'
      : 'No role-authorized communication record is available for intent or follow-up analysis.';
    result.evidence = unique(result.evidence.concat(intents.map(function (intent) { return 'Captured intent: ' + intent + '.'; })));
    result.missing = unique(result.missing.concat(withConversation < values.length
      ? [(values.length - withConversation) + ' records do not include readable conversation evidence.'] : []));
    result.risks = riskEntries(graph).concat(followUp ? [followUp + ' conversations have an unresolved follow-up state.'] : []);
    result.opportunities = intents.length ? ['Recorded caller intent can guide the next role-authorized response.'] : [];
    result.recommendations = recommendations(graph, result.objects[1] && result.objects[1].href);
    return result;
  }

  function calendarProjection(workspace) {
    var values = graphs(workspace);
    var graph = values[0];
    var result = baseProjection('calendar', workspace, graph);
    var scheduled = values.filter(function (item) { return Boolean(item && item.work && item.work.scheduledStart); });
    var unscheduled = values.length - scheduled.length;
    var keys = Object.create(null);
    var conflicts = 0;
    scheduled.forEach(function (item) {
      var assigned = safeString(item.work.assignedTo, 'unassigned');
      var key = assigned + '|' + String(item.work.scheduledStart);
      if (keys[key]) conflicts += 1;
      keys[key] = true;
    });
    result.title = 'Schedule, capacity, and attention intelligence';
    result.summary = scheduled.length + ' role-authorized work items have an appointment time; ' + unscheduled + ' do not.';
    result.evidence = scheduled.slice(0, 4).map(function (item) {
      return safeString(item.customer && item.customer.name, 'Customer') + ' is scheduled for ' +
        new Date(item.work.scheduledStart).toLocaleString() +
        (item.work.assignedTo ? ' with ' + item.work.assignedTo + '.' : ' with no recorded assignee.');
    }).concat(result.evidence.slice(0, 2));
    result.missing = unique(result.missing.concat([
      'Travel-time and route feasibility require complete location, duration, and map-routing inputs; this projection does not infer them.',
    ]));
    result.risks = conflicts ? [conflicts + ' same-time assignment collisions need review.'] : [];
    if (unscheduled) result.risks.push(unscheduled + ' work items do not have a recorded appointment time.');
    result.opportunities = scheduled.length ? ['Recorded appointment windows can support dispatch coordination.'] : [];
    result.recommendations = recommendations(graph, result.objects[2] && result.objects[2].href);
    return result;
  }

  function myNumberProjection(workspace) {
    var values = graphs(workspace);
    var graph = values[0];
    var result = baseProjection('my-number', workspace, graph);
    var configuration = workspace.configuration && workspace.configuration.myNumber;
    var captured = values.filter(function (item) {
      return item && item.communication && safeString(item.communication.channel).toLowerCase() === 'voice';
    }).length;
    result.title = 'Call capture and provider readiness';
    result.summary = configuration && safeString(configuration.status)
      ? configuration.status
      : 'Provider connection, routing health, and live-number readiness are not included in this role-authorized Command Center projection and are not inferred.';
    result.evidence = captured ? [captured + ' canonical voice communication records are present in this workspace.'].concat(result.evidence.slice(0, 2)) : [];
    result.missing = unique(result.missing.concat(configuration
      ? []
      : ['A reviewed provider connection and call-routing authority is required before readiness or performance can be stated.']));
    result.risks = captured ? [] : ['No canonical voice communication record is available in the current projection.'];
    result.opportunities = captured ? ['Captured conversations can support follow-up and scheduling review.'] : [];
    result.recommendations = [{ label: 'Verify the current number and routing authority on this page before relying on call capture.', priority: 'review' }];
    return result;
  }

  function teamProjection(workspace, supplement) {
    var values = graphs(workspace);
    var graph = values[0];
    var result = baseProjection('team', workspace, graph);
    var assigned = values.filter(function (item) { return safeString(item && item.work && item.work.assignedTo); });
    var unassigned = values.length - assigned.length;
    var members = supplement && Array.isArray(supplement.members) ? supplement.members : [];
    result.title = 'Workload, coverage, and ownership intelligence';
    result.summary = values.length
      ? assigned.length + ' of ' + values.length + ' role-authorized work records have a named owner; ' + unassigned + ' are unassigned.'
      : 'No role-authorized work records are available for workload or ownership analysis.';
    result.evidence = unique(assigned.slice(0, 4).map(function (item) {
      return safeString(item.work.assignedTo) + ' owns ' + safeString(item.work.title, 'a recorded work item') + '.';
    }).concat(members.slice(0, 3).map(function (member) {
      return safeString(member.name, 'Team member') + ' has ' + titleCase(member.accessRole) + ' access and ' +
        titleCase(member.operationalRole) + ' operational responsibility.';
    })));
    result.missing = unique(result.missing.concat(supplement
      ? []
      : ['The workforce authority was unavailable, so roster and access coverage are not inferred.']));
    result.risks = unassigned ? [unassigned + ' work records need explicit ownership.'] : [];
    result.opportunities = members.length ? [members.length + ' active workforce records are available for coverage review.'] : [];
    result.recommendations = [{ label: unassigned ? 'Assign each unowned work item before dispatch.' : 'Review current coverage before changing assignments.', priority: unassigned ? 'high' : 'review' }];
    return result;
  }

  function aiSettingsProjection(workspace) {
    var graph = currentGraph(workspace);
    var result = baseProjection('ai-settings', workspace, graph);
    var configuration = workspace.configuration && workspace.configuration.aiSettings;
    var factCount = graphs(workspace).reduce(function (count, item) {
      return count + (item && item.polaris && Array.isArray(item.polaris.facts) ? item.polaris.facts.length : 0);
    }, 0);
    result.title = 'Knowledge and configuration readiness';
    result.summary = configuration
      ? 'The isolated demo exposes reviewed fictional voice style and escalation guidance without a provider connection claim.'
      : 'Knowledge configuration, escalation rules, and provider authority are not included in this role-authorized projection and are not inferred.';
    result.evidence = factCount ? [factCount + ' supporting canonical facts are available across the current workspace.'] : [];
    if (configuration) {
      result.evidence.push('Voice style: ' + safeString(configuration.voiceStyle, 'not specified') + '.');
      result.evidence.push('Escalation guidance: ' + safeString(configuration.escalation, 'not specified') + '.');
    }
    result.missing = unique(result.missing.concat(configuration
      ? [safeString(configuration.providerConnection)]
      : ['A reviewed knowledge/configuration authority and provider connection state are required before readiness can be stated.']));
    result.risks = configuration ? [] : ['Changes should not be made from an incomplete configuration projection.'];
    result.opportunities = factCount ? ['Recorded facts can improve page-specific Polaris explanations after configuration review.'] : [];
    result.recommendations = [{ label: 'Review knowledge, escalation, and provider authority before enabling new behavior.', priority: 'review' }];
    return result;
  }

  function readinessItems(supplement) {
    if (!supplement || !supplement.items || typeof supplement.items !== 'object') return [];
    var order = Array.isArray(supplement.itemOrder) ? supplement.itemOrder : Object.keys(supplement.items);
    return order.map(function (id) { return supplement.items[id]; }).filter(function (item) {
      return item && typeof item === 'object' && safeString(item.label);
    });
  }

  function businessProfileProjection(workspace, supplement) {
    var graph = currentGraph(workspace);
    var result = baseProjection('business-profile', workspace, graph);
    var items = readinessItems(supplement);
    var ready = items.filter(function (item) { return ['reviewed', 'ready', 'complete'].indexOf(safeString(item.state).toLowerCase()) >= 0; });
    var attention = items.filter(function (item) { return ready.indexOf(item) < 0; });
    result.title = 'Business Profile completeness and downstream readiness';
    result.summary = items.length
      ? ready.length + ' of ' + items.length + ' recognized profile areas are reviewed or ready; ' + attention.length + ' need attention.'
      : 'The role-authorized Business Profile readiness authority was unavailable, so completeness is not inferred.';
    result.evidence = ready.slice(0, 5).map(function (item) { return item.label + ' is recorded as ' + titleCase(item.state) + '.'; });
    result.missing = attention.length
      ? attention.slice(0, 6).map(function (item) {
        return item.label + ': ' + safeString(item.missingReason || item.recommendedReason || item.help,
          'Review this profile area before relying on it.');
      })
      : (items.length ? [] : ['Load or complete the canonical Business Profile readiness authority.']);
    result.risks = attention.length ? ['Incomplete profile inputs can limit scheduling, pricing, routing, and customer guidance.'] : [];
    result.opportunities = ready.length ? ['Reviewed profile facts can improve downstream Polaris recommendations.'] : [];
    result.recommendations = [{ label: attention.length ? 'Review the incomplete profile areas shown on this page.' : 'Keep reviewed profile facts current.', priority: attention.length ? 'high' : 'review' }];
    return result;
  }

  function settingsProjection(workspace, supplement) {
    var graph = currentGraph(workspace);
    var result = baseProjection('settings', workspace, graph);
    var known = supplement && typeof supplement === 'object';
    var notificationKeys = ['emailEnabled', 'emailCallSummary', 'emailAppointment', 'smsEnabled', 'smsUrgent', 'smartRouting'];
    var enabled = known ? notificationKeys.filter(function (key) { return supplement[key] === true; }) : [];
    result.title = 'Operational configuration attention';
    result.summary = known
      ? enabled.length + ' recognized notification or routing preferences are enabled in the current role-authorized settings response.'
      : 'The role-authorized settings response was unavailable, so no preference state is inferred.';
    result.evidence = enabled.map(function (key) { return titleCase(key) + ' is enabled.'; });
    result.missing = unique(result.missing.concat(known
      ? []
      : ['Load the canonical account preferences before evaluating configuration attention.']));
    result.risks = known && supplement.securityEmailMandatory === true && !safeString(supplement.securityEmailAddress)
      ? ['A mandatory security email destination is not present in the returned settings authority.'] : [];
    result.opportunities = known ? ['Current preferences can be reviewed against actual operating needs.'] : [];
    result.recommendations = [{ label: 'Review configuration changes against current roles, notifications, and operating policy.', priority: 'review' }];
    return result;
  }

  function integrationsProjection(workspace, supplement) {
    var graph = currentGraph(workspace);
    var result = baseProjection('integrations', workspace, graph);
    var categories = supplement && Array.isArray(supplement.categories) ? supplement.categories : [];
    var providers = [];
    categories.forEach(function (category) {
      (Array.isArray(category.providers) ? category.providers : []).forEach(function (provider) {
        providers.push(provider);
      });
    });
    var connected = providers.filter(function (provider) {
      return safeString(provider && provider.presentation && provider.presentation.state).toLowerCase() === 'connected';
    });
    result.title = 'Integration connection and coverage intelligence';
    result.summary = providers.length
      ? providers.length + ' catalogue entries are visible; ' + connected.length + ' have reviewed connected authority. No other entry is treated as connected.'
      : 'The role-authorized integration catalogue was unavailable, so no provider connection or readiness is inferred.';
    result.evidence = providers.slice(0, 7).map(function (provider) {
      return safeString(provider.name, 'Provider') + ': ' + safeString(provider.presentation && provider.presentation.label,
        'connection authority unavailable') + '.';
    });
    result.missing = providers.filter(function (provider) {
      return connected.indexOf(provider) < 0;
    }).slice(0, 6).map(function (provider) {
      return safeString(provider.name, 'Provider') + ' is not represented as connected; authorization, sync, and health are not inferred.';
    });
    if (!providers.length) result.missing.push('Load the canonical integration catalogue before evaluating provider coverage.');
    result.risks = providers.length && !connected.length
      ? ['No reviewed connected provider authority is present in the returned catalogue.'] : [];
    result.opportunities = connected.length ? [connected.length + ' reviewed provider connections can support the capabilities shown by their own authorities.'] : [];
    result.recommendations = [{ label: 'Review each provider authority before claiming connection, sync, or readiness.', priority: 'review' }];
    return result;
  }

  function genericProjection(surface, workspace) {
    var graph = currentGraph(workspace);
    var result = baseProjection(surface, workspace, graph);
    result.title = titleCase(surface) + ' intelligence';
    result.summary = graph
      ? 'The latest role-authorized customer, lead, work, and Polaris graph informs this destination.'
      : 'No canonical graph is available for a page-specific projection.';
    result.risks = riskEntries(graph);
    result.opportunities = graph ? ['Open complete Polaris detail to inspect the supporting record.'] : [];
    result.recommendations = recommendations(graph, result.objects[1] && result.objects[1].href);
    return result;
  }

  function project(surface, workspace, supplement) {
    if (!workspace || !workspace.mode || !Array.isArray(workspace.graphs)) {
      throw new Error('The role-authorized workspace projection is unavailable.');
    }
    switch (surface) {
      case 'leads': return leadProjection(workspace);
      case 'polaris': return polarisProjection(workspace);
      case 'communications': return communicationsProjection(workspace);
      case 'calendar': return calendarProjection(workspace);
      case 'my-number': return myNumberProjection(workspace);
      case 'team': return teamProjection(workspace, supplement);
      case 'ai-settings': return aiSettingsProjection(workspace);
      case 'business-profile': return businessProfileProjection(workspace, supplement);
      case 'settings': return settingsProjection(workspace, supplement);
      case 'integrations': return integrationsProjection(workspace, supplement);
      default: return genericProjection(surface, workspace);
    }
  }

  function sessionFetch(url) {
    var options = { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (global.NorthStarAccountSession && typeof global.NorthStarAccountSession.fetch === 'function') {
      return global.NorthStarAccountSession.fetch(url, options);
    }
    return global.fetch(url, options);
  }

  function responseData(response) {
    return response.json().then(function (body) {
      if (!response.ok || !body || typeof body !== 'object') throw new Error('Role-authorized data is unavailable.');
      if (body.data && typeof body.data === 'object') return body.data;
      if (body.preferences && typeof body.preferences === 'object') return body.preferences;
      return body;
    });
  }

  function loadWorkspace(mode) {
    if (mode === 'demo' && global.NorthStarDemoRuntime && typeof global.NorthStarDemoRuntime.loadWorkspace === 'function') {
      return global.NorthStarDemoRuntime.loadWorkspace(false);
    }
    return sessionFetch('/api/v1/command-center/workspace').then(responseData).then(function (workspace) {
      var contract = global.NorthStarCommandCenterContract;
      return contract && typeof contract.validateWorkspace === 'function'
        ? contract.validateWorkspace(workspace, mode) : workspace;
    });
  }

  function loadSupplement(surface) {
    var endpoint = {
      team: '/api/workforce',
      'business-profile': '/api/v1/business-profile/profileReadiness',
      settings: '/api/account/preferences',
      integrations: '/api/v1/integrations/catalogue',
    }[surface];
    if (!endpoint) return Promise.resolve(null);
    return sessionFetch(endpoint).then(responseData).catch(function () { return null; });
  }

  function directChildHeader(main) {
    for (var index = 0; index < main.children.length; index += 1) {
      var child = main.children[index];
      if (child.id === 'northstarDemoToolbar') continue;
      if (child.matches && child.matches('.page-header, .content-header, header')) return child;
    }
    return null;
  }

  function mount(surface) {
    var main = document.querySelector('.main-content:not([aria-hidden="true"]), .main-content');
    if (!main || document.getElementById('northstarPolarisSurfaceCard')) return null;
    var section = document.createElement('section');
    section.id = 'northstarPolarisSurfaceCard';
    section.className = 'polaris-surface-card-shell';
    section.dataset.state = 'loading';
    section.setAttribute('role', 'region');
    section.setAttribute('aria-label', 'Polaris intelligence for ' + titleCase(surface));
    section.setAttribute('aria-live', 'polite');
    var status = document.createElement('p');
    status.className = 'polaris-surface-loading';
    status.textContent = 'Loading role-authorized Polaris intelligence…';
    section.appendChild(status);
    var header = directChildHeader(main);
    if (header) header.insertAdjacentElement('afterend', section);
    else {
      var toolbar = document.getElementById('northstarDemoToolbar');
      main.insertBefore(section, toolbar ? toolbar.nextSibling : main.firstChild);
    }
    return section;
  }

  function renderUnavailable(container, surface) {
    global.NorthStarPolarisCard.render(container, {
      contract: global.NorthStarPolarisCard.CONTRACT,
      surface: surface,
      detailed: DETAILED_SURFACES.indexOf(surface) >= 0,
      title: 'Polaris intelligence unavailable',
      summary: 'The page did not receive a valid role-authorized workspace projection. No tenant, customer, provider, or demo data is shown.',
      confidenceExplanation: 'Confidence is unavailable because the required authorized inputs did not load.',
      evidence: [],
      missing: ['Reload after confirming this role can access the destination.'],
      risks: ['Do not act on an incomplete intelligence projection.'],
      opportunities: [],
      recommendations: [{ label: 'Review access and retry the role-authorized page.', priority: 'review' }],
      objects: [],
    });
    container.dataset.state = 'unavailable';
    document.documentElement.dataset.northstarPolarisCard = 'unavailable';
  }

  function initialize() {
    var contract = global.NorthStarCommandCenterContract;
    var card = global.NorthStarPolarisCard;
    var route = contract && contract.routeForPath(global.location.pathname);
    if (!contract || !card || !route || route.id === 'command-center') return;
    var container = mount(route.id);
    if (!container) return;
    var mode = contract.modeForPath(global.location.pathname);
    Promise.all([loadWorkspace(mode), loadSupplement(route.id)]).then(function (values) {
      var projection = project(route.id, values[0], values[1]);
      card.render(container, projection);
      container.dataset.state = 'ready';
      container.dataset.projectionContract = PROJECTION_CONTRACT;
      document.documentElement.dataset.northstarPolarisCard = 'ready';
      global.dispatchEvent(new CustomEvent('northstar:polaris-card-ready', { detail: projection }));
    }).catch(function () { renderUnavailable(container, route.id); });
  }

  global.NorthStarPolarisSurface = Object.freeze({
    PROJECTION_CONTRACT: PROJECTION_CONTRACT,
    project: project,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})(window);
