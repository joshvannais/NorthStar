(function (global) {
  'use strict';

  var path = global.location && global.location.pathname || '';
  var active = path === '/demo-dashboard' || path === '/demo' || path.indexOf('/demo/') === 0;
  if (!active) {
    global.NorthStarDemoRuntime = Object.freeze({ active: false });
    return;
  }

  document.documentElement.classList.add('northstar-demo-mode');
  var nativeFetch = global.fetch.bind(global);
  var workspace = null;
  var workspaceRequest = null;
  var accountRequest = null;
  var readonlyMessage = 'This account-free demo is read-only outside Simulate Lead and Reset demo.';
  var TOOLBAR_EXCLUDED_PATHS = Object.freeze([
    '/demo/polaris',
    '/demo/business-profile',
    '/demo/settings',
    '/demo/integrations',
  ]);

  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  function requestPath(input) {
    var value = typeof input === 'string' ? input : input && input.url;
    return new URL(String(value || ''), global.location.origin);
  }

  function methodOf(options, input) {
    return String(options && options.method || input && input.method || 'GET').toUpperCase();
  }

  function loadWorkspace(force) {
    if (workspace && !force) return Promise.resolve(workspace);
    if (workspaceRequest && !force) return workspaceRequest;
    workspaceRequest = nativeFetch('/api/demo/command-center', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || body.success !== true || !body.data) {
          throw new Error('The isolated demo workspace is unavailable.');
        }
        workspace = body.data;
        try {
          global.sessionStorage.setItem('northstarSessionOwner', 'demo-' + workspace.session.id);
          global.sessionStorage.setItem('northstarSessionId', workspace.session.id);
        } catch (_storageError) {}
        document.documentElement.dataset.demoRevision = String(workspace.integrity.revision);
        document.documentElement.dataset.demoWorkspace = 'ready';
        global.dispatchEvent(new CustomEvent('northstar:demo-workspace', { detail: workspace }));
        return workspace;
      });
    }).catch(function (error) {
      document.documentElement.dataset.demoWorkspace = 'error';
      throw error;
    }).finally(function () { workspaceRequest = null; });
    return workspaceRequest;
  }

  function accountFromWorkspace(value) {
    return {
      mode: 'demo',
      demo: true,
      user: {
        id: value.viewer.id,
        userId: value.viewer.id,
        status: 'active',
        name: value.viewer.label,
        email: 'account-free-demo@northstar.invalid',
        phone: value.configuration.myNumber.displayNumber,
      },
      organization: { id: value.tenant.id, name: value.tenant.name },
      membership: { role: 'viewer', status: 'active' },
      onboarding: { status: 'complete' },
      navigation: value.navigation,
      workspace: { revision: value.integrity.revision, digest: value.integrity.digest },
    };
  }

  function loadAccount(force) {
    if (accountRequest && !force) return accountRequest;
    accountRequest = loadWorkspace(Boolean(force)).then(accountFromWorkspace)
      .finally(function () { accountRequest = null; });
    return accountRequest;
  }

  function preferences(value) {
    return {
      companyName: value.tenant.name,
      companyPhone: value.configuration.myNumber.displayNumber,
      services: value.graphs.map(function (graph) { return graph.lead.serviceLabel; }).filter(function (item, index, list) {
        return list.indexOf(item) === index;
      }).join(', '),
      companyInfo: 'Fictional, isolated home-service workspace for the NorthStar product demo.',
      smsNumber: value.configuration.myNumber.displayNumber,
      emailAddress: 'demo@northstar.invalid',
      emailEnabled: true,
      emailCallSummary: true,
      emailAppointment: true,
      smsEnabled: true,
      smsUrgent: true,
      smartRouting: true,
      contacts: [],
      securityEmailMandatory: true,
      securityEmailAddress: 'demo@northstar.invalid',
    };
  }

  function workforce(value) {
    var locationId = 'demo-location-main';
    var skillIds = ['demo-skill-estimates', 'demo-skill-dispatch'];
    return {
      data: {
        invitations: [],
        members: value.configuration.workforce.members.map(function (member, index) {
          return {
            profileId: member.id,
            membershipId: 'demo-membership-' + String(index + 1),
            name: member.name,
            email: member.name.toLowerCase().replace(/[^a-z]+/g, '.') + '@northstar.invalid',
            phone: '',
            accessRole: member.accessRole,
            membershipStatus: 'active',
            operationalRole: member.operationalRole.toLowerCase().replace(/\s+/g, '_'),
            homeLocationId: locationId,
            skillIds: index === 0 ? skillIds : [skillIds[index % skillIds.length]],
          };
        }),
        skills: [
          { id: skillIds[0], key: 'estimates', name: 'Estimate visits', description: 'Fictional estimate-visit capability.', serviceId: 'demo-service-home' },
          { id: skillIds[1], key: 'dispatch', name: 'Dispatch', description: 'Fictional scheduling and dispatch capability.', serviceId: null },
        ],
        crews: value.configuration.workforce.crews.map(function (crew) {
          return {
            id: crew.id, key: crew.id, name: crew.name, homeLocationId: locationId,
            members: value.configuration.workforce.members.slice(1).map(function (member, index) {
              return { profileId: member.id, role: index === 1 ? 'lead' : 'member' };
            }),
          };
        }),
        locations: [{ id: locationId, name: 'Main service area' }],
        services: [{ id: 'demo-service-home', name: 'Home services' }],
        policies: [{ id: 'demo-policy-review', name: 'Review before dispatch', description: 'Confirm scope and appointment details before dispatch.', enabled: true }],
        businessProfile: { version: 'demo-v1' },
      },
    };
  }

  function mapPreferences(value) {
    var documentValue = value.configuration.settings.maps.effective;
    var timestamp = value.session.expiresAt;
    return {
      success: true,
      requestId: 'demo-map-preferences-' + value.session.id,
      data: {
        authority: 'canonical_map_preferences_v1',
        contractVersion: 1,
        providers: [
          { key: 'google_maps', name: 'Google Maps' },
          { key: 'apple_maps', name: 'Apple Maps' },
          { key: 'waze', name: 'Waze' },
        ],
        organization: { version: 1, preferences: documentValue, source: 'system_default', updatedAt: timestamp },
        user: { version: 0, mode: 'inherit', hasStoredAuthority: false, preferences: null, updatedAt: null },
        effective: {
          source: 'organization', inheritsOrganization: true, organizationVersion: 1, userVersion: 0,
          preferences: documentValue,
        },
        permissions: { canUpdateOrganization: false, canUpdateSelf: false },
      },
    };
  }

  function businessProfile(value) {
    var configuration = value.configuration.businessProfile;
    var hours = {};
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].forEach(function (day) {
      hours[day] = { open: '08:00', close: '17:00', lunch: '', emergency: false, afterHours: false };
    });
    ['saturday', 'sunday'].forEach(function (day) {
      hours[day] = { open: '', close: '', lunch: '', emergency: false, afterHours: false };
    });
    hours.holidays = [];
    return {
      canonicalAuthority: { version: 'demo-v1', legacyMigration: { pending: false } },
      company: {
        name: configuration.company, dba: '', email: 'demo@northstar.invalid',
        phone: value.configuration.myNumber.displayNumber, website: '', logo: '', taxId: '',
        timeZone: 'America/New_York', currency: 'USD',
      },
      headquarters: { street: '', city: 'Sample City', state: 'NC', zip: '28000', country: 'US', latitude: '', longitude: '', additionalOffices: [] },
      serviceArea: { maxRadiusMiles: 35, maxTravelMinutes: 60, primaryTerritory: 'Fictional service area', polygon: [] },
      routing: { preferredProvider: 'google_maps', dispatchFrom: 'headquarters', trafficEnabled: true, useLiveTraffic: false, avoidTolls: false, avoidHighways: false, avoidFerries: false },
      hours: hours,
      policies: { customer_guidance: 'Confirm scope and appointment details before dispatch.' },
      services: [],
      crew: { defaultCrewSize: 2, maxCrewSize: 4, shopTime: 30 },
      vehicles: { truckCount: 2, trailerCount: 1, averageMpg: 15, equipmentTransportCapacity: '' },
      scheduling: { maxJobsPerDay: 6, travelBuffer: 30, appointmentBuffer: 15, workDayLength: 8, maxDailyTravel: 180, preferredDispatchStrategy: 'balanced' },
      canonicalPricing: {},
      canonicalCosts: {},
      polaris: { responseStyle: 'professional', detailLevel: 'balanced', recommendationStyle: 'actionable', showCalculations: true, showConfidence: true, showExecutiveReasoning: true, conciseMode: false, executiveMode: false },
      industry: configuration.industry,
      ownerName: 'Maria Rivera',
      businessDescription: 'Fictional home-service contractor used only for this isolated product demo.',
      emergencyPolicy: 'Escalate urgent safety risks to the on-call owner.',
      customPrompt: '',
      faq: [],
      companyValues: ['Clear communication', 'Reliable follow-through'],
      voiceAssistant: {
        name: 'NorthStar Office Manager', style: value.configuration.aiSettings.voiceStyle,
        greeting: 'Thank you for calling Rivera Home Services. How can I help today?',
        personality: 'professional', conversationStyle: 'concise', escalationRules: { rules: [] },
      },
      notifications: {},
    };
  }

  function readiness(value) {
    var source = value.configuration.businessProfile.readiness;
    var items = {};
    var order = [];
    source.items.forEach(function (item, index) {
      var itemId = 'demo-readiness-' + String(index + 1);
      order.push(itemId);
      items[itemId] = {
        id: itemId, label: item.label, help: 'Review this recognized Business Profile area before relying on it.',
        state: item.state, sourceState: item.state, missingReason: null, recommendedReason: null,
        lastReviewedAt: item.state === 'reviewed' ? value.session.expiresAt : null,
        canReview: false, canMarkNotApplicable: false, canMarkApplicable: false,
      };
    });
    return {
      canonicalAuthority: { version: 'demo-v1' },
      overallState: 'review_needed', itemOrder: order, items: items, hasStoredReadiness: true,
    };
  }

  function transport(input, options) {
    var url = requestPath(input);
    var method = methodOf(options, input);
    if (url.origin !== global.location.origin) {
      return Promise.resolve(jsonResponse({ error: readonlyMessage, code: 'demo_external_request_blocked' }, 403));
    }
    if (url.pathname.indexOf('/api/demo/') === 0) return nativeFetch(input, options);

    if (method === 'GET' && url.pathname.indexOf('/api/v1/canonical/compat/') === 0) {
      return nativeFetch('/api/demo/command-center/canonical/compat/' +
        encodeURIComponent(decodeURIComponent(url.pathname.slice('/api/v1/canonical/compat/'.length))) + url.search,
      Object.assign({}, options || {}, { credentials: 'same-origin' }));
    }
    if (method === 'GET' && url.pathname.indexOf('/api/v1/canonical/surfaces/') === 0) {
      return nativeFetch('/api/demo/command-center/canonical/surfaces/' +
        encodeURIComponent(decodeURIComponent(url.pathname.slice('/api/v1/canonical/surfaces/'.length))) + url.search,
      Object.assign({}, options || {}, { credentials: 'same-origin' }));
    }

    return loadWorkspace(false).then(function (value) {
      if (method === 'GET' && url.pathname === '/api/auth/me') return jsonResponse({ account: accountFromWorkspace(value) });
      if (method === 'GET' && url.pathname === '/api/account/subscription') {
        return jsonResponse({ subscription: { safe: true, state: 'active', serverTimestamp: new Date().toISOString() } });
      }
      if (method === 'GET' && url.pathname === '/api/account/preferences') return jsonResponse({ success: true, preferences: preferences(value) });
      if (method === 'GET' && url.pathname === '/api/workforce') return jsonResponse(workforce(value));
      if (method === 'GET' && url.pathname === '/api/v1/integrations/catalogue') {
        return jsonResponse({ success: true, data: value.configuration.integrations });
      }
      if (method === 'GET' && url.pathname === '/api/account/map-preferences') return jsonResponse(mapPreferences(value));
      if (method === 'GET' && url.pathname === '/api/v1/business-profile/profileReadiness') {
        return jsonResponse({ success: true, data: readiness(value) });
      }
      if (method === 'GET' && (url.pathname === '/api/v1/business-profile' ||
          url.pathname === '/api/v1/business-profile/operationalConfiguration' ||
          url.pathname === '/api/v1/business-profile/financialConfiguration' ||
          url.pathname === '/api/v1/business-profile/voiceAssistant')) {
        return jsonResponse({ success: true, data: businessProfile(value) });
      }
      if (method === 'GET' && url.pathname === '/api/assets') {
        return jsonResponse({ success: true, data: { items: [], count: 0, readOnly: true } });
      }
      if (method === 'GET' && url.pathname === '/api/v1/command-center/workspace') {
        return jsonResponse({ success: true, data: value });
      }
      return jsonResponse({ error: readonlyMessage, code: 'demo_read_only' }, method === 'GET' ? 404 : 403);
    });
  }

  function routeTarget(href) {
    var url;
    try { url = new URL(href, global.location.origin); } catch (_error) { return null; }
    if (url.origin !== global.location.origin) return null;
    var contract = global.NorthStarCommandCenterContract;
    if (contract && Array.isArray(contract.ROUTES)) {
      for (var index = 0; index < contract.ROUTES.length; index += 1) {
        var route = contract.ROUTES[index];
        if (url.pathname === route.paidPath) {
          return route.demoPath + url.search + url.hash;
        }
      }
    }
    if (url.pathname === '/dashboard/executive-brief') return '/demo' + url.search + url.hash;
    if (url.pathname === '/dashboard/lead') {
      var leadId = url.searchParams.get('id');
      return '/demo/polaris' + (leadId ? '?leadId=' + encodeURIComponent(leadId) : '');
    }
    return null;
  }

  function rewriteLinks(root) {
    var links = (root || document).querySelectorAll ? (root || document).querySelectorAll('a[href]') : [];
    for (var index = 0; index < links.length; index += 1) {
      var target = routeTarget(links[index].getAttribute('href'));
      if (target) links[index].setAttribute('href', target);
    }
  }

  function control(tag, text, className) {
    var element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function mutationHeaders(intent) {
    var key = global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID() : String(Date.now()) + '-demo-action';
    return {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      'X-NorthStar-Demo-Intent': intent,
    };
  }

  function performMutation(endpoint, intent, body, button, status) {
    button.disabled = true;
    status.textContent = 'Updating the isolated demo workspace…';
    return nativeFetch(endpoint, {
      method: 'POST', credentials: 'same-origin', headers: mutationHeaders(intent), body: JSON.stringify(body),
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.success !== true || !payload.data) {
          throw new Error(payload && payload.error && payload.error.message || 'The demo action could not be completed.');
        }
        workspace = payload.data;
        try {
          global.sessionStorage.setItem('northstarSessionId', workspace.session.id);
          global.sessionStorage.setItem('northstarDemoNotice', intent === 'reset'
            ? 'Demo restored to its starting state.' : 'One fictional lead was added across every demo destination.');
        } catch (_storageError) {}
        global.location.reload();
      });
    }).catch(function (error) {
      status.textContent = error.message || 'The demo action could not be completed.';
      button.disabled = false;
    });
  }

  function installToolbar(value) {
    if (document.getElementById('northstarDemoToolbar')) return;
    if (TOOLBAR_EXCLUDED_PATHS.indexOf(path) >= 0) return;
    var main = document.querySelector('.main-content');
    if (!main) return;
    var scenarioSpace = value && value.configuration && value.configuration.scenarioSpace;
    var scenarioReady = scenarioSpace && scenarioSpace.contract === 'northstar_demo_scenario_space_v1' &&
      Number.isSafeInteger(scenarioSpace.combinationCount) && scenarioSpace.combinationCount >= 100 &&
      Array.isArray(scenarioSpace.dimensions) && scenarioSpace.dimensions.length >= 6;
    var section = control('section', '', 'northstar-demo-toolbar');
    section.id = 'northstarDemoToolbar';
    section.setAttribute('aria-label', 'Account-free demo controls');
    var copy = control('div', '', 'northstar-demo-toolbar-copy');
    copy.append(control('strong', 'Account-free demo workspace', 'northstar-demo-toolbar-title'));
    var metadata = control('span', 'Fictional Data · Shared Across Every Demo Page', 'northstar-demo-toolbar-meta');
    metadata.id = 'northstarDemoRevision';
    copy.append(metadata);
    var builder = document.createElement('details');
    builder.className = 'northstar-demo-scenario-builder';
    builder.open = (path === '/demo' || path === '/demo-dashboard') &&
      global.matchMedia && global.matchMedia('(min-width: 769px)').matches;
    var summary = control('summary', scenarioReady
      ? 'Build a lead scenario · ' + Number(scenarioSpace.combinationCount).toLocaleString() + ' material combinations'
      : 'Scenario builder unavailable');
    builder.appendChild(summary);
    var selections = Object.create(null);
    var scenarioGrid = control('div', '', 'northstar-demo-scenario-grid');
    var businessSummary = control('p', '', 'northstar-demo-business-summary');
    businessSummary.id = 'northstarDemoBusinessSummary';
    if (scenarioReady) {
      scenarioSpace.dimensions.forEach(function (dimension, dimensionIndex) {
        if (!dimension || typeof dimension.id !== 'string' || typeof dimension.label !== 'string' ||
            !Array.isArray(dimension.options) || !dimension.options.length) {
          scenarioReady = false;
          return;
        }
        var field = control('div', '', 'northstar-demo-scenario-field');
        var id = 'demoScenario-' + dimension.id;
        var label = control('label', dimension.label);
        label.htmlFor = id;
        var select = document.createElement('select');
        select.id = id;
        select.dataset.scenarioDimension = dimension.id;
        dimension.options.forEach(function (definition) {
          var option = document.createElement('option');
          option.value = definition.id;
          option.textContent = definition.label;
          option.title = definition.description || '';
          if (scenarioSpace.defaultSelection && scenarioSpace.defaultSelection[dimension.id] === definition.id) {
            option.selected = true;
          }
          select.appendChild(option);
        });
        selections[dimension.id] = select;
        field.append(label, select);
        scenarioGrid.appendChild(field);
        if (dimensionIndex === 0) {
          select.setAttribute('aria-describedby', 'northstarDemoBusinessSummary northstarDemoScenarioHelp');
          var updateBusinessSummary = function () {
            var selected = dimension.options.find(function (candidate) { return candidate.id === select.value; });
            businessSummary.textContent = selected && selected.description || '';
          };
          select.addEventListener('change', updateBusinessSummary);
          updateBusinessSummary();
        }
      });
    }
    var scenarioHelp = control('p', scenarioReady
      ? 'Each choice changes the conversation, record graph, schedule, risk, recommendations, and Polaris evidence—not just the label.'
      : 'The shared scenario contract could not be verified. No demo mutation is available.',
    'northstar-demo-scenario-help');
    scenarioHelp.id = 'northstarDemoScenarioHelp';
    builder.append(scenarioGrid, businessSummary, scenarioHelp);
    var actions = control('div', '', 'northstar-demo-toolbar-actions');
    var simulate = control('button', 'Simulate Lead', 'btn btn-primary');
    simulate.id = 'demoSimulateLead';
    simulate.type = 'button';
    simulate.disabled = !scenarioReady;
    var reset = control('button', 'Reset Demo', 'btn btn-secondary');
    reset.id = 'demoReset';
    reset.type = 'button';
    var exit = control('a', 'Exit Demo', 'btn btn-ghost');
    exit.href = '/';
    actions.append(simulate, reset, exit);
    var status = control('p', '', 'northstar-demo-toolbar-status');
    status.id = 'northstarDemoStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    try {
      status.textContent = global.sessionStorage.getItem('northstarDemoNotice') ||
        'Every destination reads this same isolated fictional workspace.';
      global.sessionStorage.removeItem('northstarDemoNotice');
    } catch (_storageError) {
      status.textContent = 'Every destination reads this same isolated fictional workspace.';
    }
    section.append(copy, builder, actions, status);
    main.insertBefore(section, main.firstChild);
    simulate.addEventListener('click', function () {
      var selected = {};
      Object.keys(selections).forEach(function (dimension) { selected[dimension] = selections[dimension].value; });
      performMutation('/api/demo/command-center/simulations/leads', 'simulate-lead', {
        scenario: selected, expectedRevision: workspace.integrity.revision,
      }, simulate, status);
    });
    reset.addEventListener('click', function () {
      performMutation('/api/demo/command-center/reset', 'reset', {
        expectedRevision: workspace.integrity.revision,
      }, reset, status);
    });
  }

  function initializeDocument() {
    document.body.classList.add('northstar-demo-mode');
    rewriteLinks(document);
    var observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        for (var index = 0; index < record.addedNodes.length; index += 1) {
          var node = record.addedNodes[index];
          if (node.nodeType === 1) rewriteLinks(node);
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    loadWorkspace(false).then(function (value) {
      installToolbar(value);
    }).catch(function () {
      var main = document.querySelector('.main-content');
      if (!main) return;
      var error = control('p', 'The isolated demo workspace is unavailable. No account or production data was loaded.', 'northstar-demo-error');
      error.setAttribute('role', 'alert');
      main.insertBefore(error, main.firstChild);
    });
  }

  global.NorthStarDemoRuntime = Object.freeze({
    active: true,
    fetch: transport,
    getWorkspace: function () { return workspace; },
    loadAccount: loadAccount,
    loadWorkspace: loadWorkspace,
  });
  global.NorthStarDemoCommandCenter = global.NorthStarDemoRuntime;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeDocument, { once: true });
  else initializeDocument();
})(window);
