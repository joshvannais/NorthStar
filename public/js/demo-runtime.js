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
  var SCENARIO_PREFERENCES_KEY = 'northstarDemoScenarioPreferences';
  var RETURN_TO_TOOLBAR_KEY = 'northstarDemoReturnToToolbar';
  var returnToToolbarRequested = false;
  try {
    returnToToolbarRequested = Boolean(global.sessionStorage.getItem(RETURN_TO_TOOLBAR_KEY));
    if (returnToToolbarRequested && global.history && 'scrollRestoration' in global.history) {
      global.history.scrollRestoration = 'manual';
    }
  } catch (_storageError) {}
  var TOOLBAR_EXCLUDED_PATHS = Object.freeze([
    '/demo/polaris',
    '/demo/team',
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
        email: value.configuration.businessProfile.email,
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
      services: value.configuration.businessProfile.services.map(function (service) { return service.label; }).join(', '),
      companyInfo: value.configuration.businessProfile.description,
      smsNumber: value.configuration.myNumber.displayNumber,
      emailAddress: value.configuration.businessProfile.email,
      emailEnabled: true,
      emailCallSummary: true,
      emailAppointment: true,
      smsEnabled: true,
      smsUrgent: true,
      smartRouting: true,
      contacts: [],
      securityEmailMandatory: true,
      securityEmailAddress: value.configuration.businessProfile.email,
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
            email: member.email,
            phone: member.phone,
            accessRole: member.accessRole,
            membershipStatus: 'active',
            operationalRole: member.operationalRole.toLowerCase().replace(/\s+/g, '_'),
            homeLocationId: locationId,
            skillIds: index === 0 ? skillIds : [skillIds[index % skillIds.length]],
          };
        }),
        skills: [
          { id: skillIds[0], key: 'estimates', name: 'Estimate visits', description: 'Demo estimate-visit capability.', serviceId: 'demo-service-home' },
          { id: skillIds[1], key: 'dispatch', name: 'Dispatch', description: 'Demo scheduling and dispatch capability.', serviceId: null },
        ],
        crews: value.configuration.workforce.crews.map(function (crew) {
          return {
            id: crew.id, key: crew.id, name: crew.name, homeLocationId: locationId,
            members: value.configuration.workforce.members.slice(1).map(function (member, index) {
              return { profileId: member.id, role: index === 1 ? 'lead' : 'member' };
            }),
          };
        }),
        locations: [{ id: locationId, name: value.configuration.businessProfile.serviceArea }],
        services: value.configuration.businessProfile.services.map(function (service) {
          return { id: service.id, name: service.label };
        }),
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
        name: configuration.company, dba: '', email: configuration.email,
        phone: value.configuration.myNumber.displayNumber, website: '', logo: '', taxId: '',
        timeZone: configuration.timeZone, currency: 'USD',
      },
      headquarters: {
        street: configuration.headquarters.street,
        city: configuration.headquarters.city,
        state: configuration.headquarters.state,
        zip: configuration.headquarters.postalCode,
        country: configuration.headquarters.country,
        latitude: configuration.headquarters.coordinates.latitude,
        longitude: configuration.headquarters.coordinates.longitude,
        additionalOffices: [],
      },
      serviceArea: { maxRadiusMiles: configuration.serviceRadiusMiles, maxTravelMinutes: 60, primaryTerritory: configuration.serviceArea, polygon: [] },
      routing: { preferredProvider: 'google_maps', dispatchFrom: 'headquarters', trafficEnabled: true, useLiveTraffic: false, avoidTolls: false, avoidHighways: false, avoidFerries: false },
      hours: hours,
      policies: { customer_guidance: 'Confirm scope and appointment details before dispatch.' },
      services: configuration.services.map(function (service) {
        return { id: service.id, name: service.label, description: 'Fictional ' + service.label.toLowerCase() + ' capability.', enabled: true };
      }),
      crew: { defaultCrewSize: 2, maxCrewSize: 4, shopTime: 30 },
      vehicles: { truckCount: Math.max(2, configuration.crewCount), trailerCount: 1, averageMpg: 15, equipmentTransportCapacity: '' },
      scheduling: { maxJobsPerDay: Math.max(4, configuration.crewCount * 3), travelBuffer: 30, appointmentBuffer: 15, workDayLength: 8, maxDailyTravel: 180, preferredDispatchStrategy: 'balanced' },
      canonicalPricing: {},
      canonicalCosts: {},
      polaris: { responseStyle: 'professional', detailLevel: 'balanced', recommendationStyle: 'actionable', showCalculations: true, showConfidence: true, showExecutiveReasoning: true, conciseMode: false, executiveMode: false },
      industry: configuration.industry,
      ownerName: configuration.ownerName,
      businessDescription: configuration.description,
      emergencyPolicy: 'Escalate urgent safety risks to the on-call owner.',
      customPrompt: '',
      faq: [],
      companyValues: ['Clear communication', 'Reliable follow-through'],
      voiceAssistant: {
        name: 'NorthStar Office Manager', style: value.configuration.aiSettings.voiceStyle,
        greeting: configuration.voiceAssistant.greeting,
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

  function demoDigest(character) {
    return new Array(65).join(character);
  }

  function demoKnowledgeItems(value) {
    var at = value.session.expiresAt;
    return [
      {
        entryId: '10000000-0000-4000-8000-000000000001', canonicalKey: 'generated.identity', category: 'generated_knowledge',
        version: { id: '20000000-0000-4000-8000-000000000001', number: 2, digest: demoDigest('a'), label: 'Business identity', origin: 'generated', sensitivity: 'internal', reviewRequirement: 'standard', applicability: { projection: { audiences: ['customer', 'internal'] } }, contentState: 'ready', lifecycleAction: 'revision', actorUserId: value.viewer.id, createdAt: at },
        workflowStatus: 'published', latestReviewEventId: '30000000-0000-4000-8000-000000000001',
        publication: { id: '40000000-0000-4000-8000-000000000001', number: 2, versionId: '20000000-0000-4000-8000-000000000001', digest: demoDigest('a'), actorUserId: value.viewer.id, publishedAt: at },
        sources: ['business_profile', 'system_generation'],
        sourceCorrection: { label: 'Correct this in Business Profile: company', section: 'company', focus: 'company-name', url: '/dashboard/business-profile?section=company#company-name' },
      },
      {
        entryId: '10000000-0000-4000-8000-000000000002', canonicalKey: 'generated.customer_workforce_guidance', category: 'guidance',
        version: { id: '20000000-0000-4000-8000-000000000002', number: 1, digest: demoDigest('b'), label: 'Customer and workforce guidance', origin: 'generated', sensitivity: 'internal', reviewRequirement: 'standard', applicability: { projection: { audiences: ['customer', 'workforce'] } }, contentState: 'ready', lifecycleAction: 'initial', actorUserId: value.viewer.id, createdAt: at },
        workflowStatus: 'review', latestReviewEventId: '30000000-0000-4000-8000-000000000002', publication: null,
        sources: ['business_profile', 'workforce', 'system_generation'],
        sourceCorrection: { label: 'Correct this in Business Profile: policies', section: 'policies', focus: 'policiesContainer', url: '/dashboard/business-profile?section=policies#policiesContainer' },
      },
      {
        entryId: '10000000-0000-4000-8000-000000000003', canonicalKey: 'generated.voice_guidance', category: 'guidance',
        version: { id: '20000000-0000-4000-8000-000000000003', number: 3, digest: demoDigest('c'), label: 'Provider-neutral voice guidance', origin: 'generated', sensitivity: 'internal', reviewRequirement: 'standard', applicability: { projection: { consumers: ['voice_runtime'], audiences: ['customer'] } }, contentState: 'ready', lifecycleAction: 'rollback', actorUserId: value.viewer.id, createdAt: at },
        workflowStatus: 'approved', latestReviewEventId: '30000000-0000-4000-8000-000000000003',
        publication: { id: '40000000-0000-4000-8000-000000000003', number: 1, versionId: '20000000-0000-4000-8000-000000000030', digest: demoDigest('d'), actorUserId: value.viewer.id, publishedAt: at },
        sources: ['business_profile', 'system_generation'],
        sourceCorrection: { label: 'Correct this in Business Profile: voice and knowledge', section: 'retell', focus: 'voice-assistant-configuration', url: '/dashboard/business-profile?section=retell#voice-assistant-configuration' },
      },
    ];
  }

  function demoSyncTarget(value, item, status) {
    var targetId = '50000000-0000-4000-8000-00000000000' + String(item.entryId.slice(-1));
    return {
      targetId: targetId, providerKey: 'demo_voice_preview', consumer: 'voice_runtime', audience: 'customer',
      capabilities: ['identity', 'guidance'], targetRevision: 2, configurationDigest: demoDigest('e'), targetStatus: status === 'suspended' ? 'suspended' : 'active',
      status: status, canonicalStatus: status === 'current' ? 'in_sync' : status === 'drifted' ? 'drift' : status,
      diagnosticCategory: status === 'drifted' ? 'projection_digest_mismatch' : status === 'suspended' ? 'target_suspended' : null,
      desired: { eventId: '60000000-0000-4000-8000-00000000000' + String(item.entryId.slice(-1)), sequence: 2, projectionDigest: item.version.digest, sourcePins: [{ entryId: item.entryId, versionId: item.version.id, canonicalDigest: item.version.digest }], state: status === 'current' ? 'succeeded' : status === 'suspended' ? 'blocked' : 'retry', attemptCount: status === 'drifted' ? 1 : 0, availableAt: value.session.expiresAt },
      observed: status === 'suspended' ? null : { eventId: '70000000-0000-4000-8000-00000000000' + String(item.entryId.slice(-1)), sequence: 1, projectionDigest: status === 'drifted' ? demoDigest('f') : item.version.digest, observedAt: value.session.expiresAt },
      lastKnownGood: status === 'suspended' ? null : { eventId: '70000000-0000-4000-8000-00000000000' + String(item.entryId.slice(-1)), sequence: 1, projectionDigest: item.version.digest },
      driftDetectedAt: status === 'drifted' ? value.session.expiresAt : null, updatedAt: value.session.expiresAt,
    };
  }

  function demoKnowledgeList(value, url) {
    var all = demoKnowledgeItems(value);
    var keys = ['category', 'workflowStatus', 'sensitivity', 'source', 'applicability'];
    var filtered = all.filter(function (item) {
      return keys.every(function (key) {
        var selected = url.searchParams.get(key);
        if (!selected) return true;
        if (key === 'source') return item.sources.indexOf(selected) >= 0;
        if (key === 'applicability') return JSON.stringify(item.version.applicability).indexOf('"' + selected + '"') >= 0;
        if (key === 'workflowStatus') return item.workflowStatus === selected;
        return (key === 'category' ? item.category : item.version.sensitivity) === selected;
      });
    });
    var statusCounts = {}, categoryCounts = {}, sensitivityCounts = {}, sourceCounts = {};
    all.forEach(function (item) {
      statusCounts[item.workflowStatus] = (statusCounts[item.workflowStatus] || 0) + 1;
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
      sensitivityCounts[item.version.sensitivity] = (sensitivityCounts[item.version.sensitivity] || 0) + 1;
      item.sources.forEach(function (source) { sourceCounts[source] = (sourceCounts[source] || 0) + 1; });
    });
    var targets = [demoSyncTarget(value, all[0], 'current'), demoSyncTarget(value, all[1], 'drifted'), demoSyncTarget(value, all[2], 'suspended')];
    return {
      authority: 'isolated_demo_knowledge_preview_v1', role: 'viewer', simulated: true,
      permissions: { canMutate: false, canReadProtected: false },
      filters: {}, counts: { total: all.length, category: categoryCounts, workflowStatus: statusCounts, sensitivity: sensitivityCounts, source: sourceCounts },
      filteredCount: filtered.length, items: filtered,
      synchronization: { counts: { current: 1, drifted: 1, suspended: 1 }, targets: targets },
    };
  }

  function demoKnowledgeDetail(value, entryId, versionNumber) {
    var item = demoKnowledgeItems(value).find(function (candidate) { return candidate.entryId === entryId; });
    if (!item) return null;
    var selectedNumber = versionNumber ? Number(versionNumber) : item.version.number;
    var isHistorical = selectedNumber < item.version.number;
    var versionId = isHistorical ? '20000000-0000-4000-8000-000000000010' : item.version.id;
    var versionDigest = isHistorical ? demoDigest('d') : item.version.digest;
    var content = item.canonicalKey === 'generated.identity'
      ? { state: 'ready', facts: { company: { name: value.tenant.name, industry: value.configuration.businessProfile.industry } } }
      : item.canonicalKey.indexOf('voice') >= 0
        ? { state: 'ready', facts: { greeting: value.configuration.businessProfile.voiceAssistant && value.configuration.businessProfile.voiceAssistant.greeting || 'Welcome to the NorthStar demo.' } }
        : { state: 'ready', facts: { guidance: 'Confirm scope and appointment details before dispatch.' } };
    var targetStatus = item.entryId.slice(-1) === '1' ? 'current' : item.entryId.slice(-1) === '2' ? 'drifted' : 'suspended';
    var history = [
      { versionId: '20000000-0000-4000-8000-000000000010', versionNumber: 1, canonicalDigest: demoDigest('d'), parentVersionId: null, lifecycleAction: 'initial', rollbackTargetVersionId: null, origin: 'generated', sensitivity: 'internal', reviewRequirement: 'standard', actorUserId: value.viewer.id, reason: 'Generated from the isolated demo Business Profile.', createdAt: value.session.expiresAt, publicationId: item.publication && item.publication.id, publicationNumber: item.publication && 1, audit: null },
    ];
    if (item.version.number > 1) history.push({ versionId: item.version.id, versionNumber: item.version.number, canonicalDigest: item.version.digest, parentVersionId: history[0].versionId, lifecycleAction: item.version.lifecycleAction, rollbackTargetVersionId: item.version.lifecycleAction === 'rollback' ? history[0].versionId : null, origin: 'generated', sensitivity: 'internal', reviewRequirement: 'standard', actorUserId: value.viewer.id, reason: 'Simulated immutable demo lifecycle evidence.', createdAt: value.session.expiresAt, publicationId: item.workflowStatus === 'published' && item.publication && item.publication.id, publicationNumber: item.workflowStatus === 'published' ? item.publication.number : null, audit: null });
    return {
      authority: 'isolated_demo_knowledge_preview_v1', role: 'viewer', simulated: true,
      permissions: { canMutate: false, canReviseDirectly: false, canReadHistory: true },
      entry: { id: item.entryId, canonicalKey: item.canonicalKey, category: item.category },
      version: { id: versionId, number: selectedNumber, schemaVersion: 1, origin: item.version.origin, label: item.version.label, sensitivity: item.version.sensitivity, reviewRequirement: item.version.reviewRequirement, applicability: item.version.applicability, document: { applicability: item.version.applicability, canonicalKey: item.canonicalKey, content: content, entryType: item.category, label: item.version.label, origin: item.version.origin, reviewRequirement: item.version.reviewRequirement, schemaVersion: 1, sensitivity: item.version.sensitivity }, canonicalDocument: JSON.stringify(content), canonicalDigest: versionDigest, parentVersionId: isHistorical ? null : history[0].versionId, lifecycleAction: isHistorical ? 'initial' : item.version.lifecycleAction, rollbackTargetVersionId: null, actorUserId: value.viewer.id, reason: 'Simulated immutable demo evidence.', createdAt: value.session.expiresAt, provenance: [{ ordinal: 1, sourceType: 'business_profile', sourceRecordId: 'demo-business-profile', sourceVersion: 'demo-v1', sourceDigest: demoDigest('9'), jsonPointer: '' }, { ordinal: 2, sourceType: 'system_generation', sourceRecordId: 'mission-21-demo-contract', sourceVersion: '1', sourceDigest: demoDigest('8'), jsonPointer: '' }] },
      workflow: { status: isHistorical ? 'published' : item.workflowStatus, latestReviewEventId: item.latestReviewEventId, events: [], snapshot: null, attorneyReviewEvidence: null, approvalEvidenceStatus: item.workflowStatus === 'approved' || item.workflowStatus === 'published' ? 'approved' : 'not_approved' },
      comparison: { document: { operations: isHistorical ? [] : [{ op: 'replace', path: '/content', value: content }] , schemaVersion: 1 }, canonicalDiff: '{}', diffDigest: demoDigest('7'), baseVersionId: history[0].versionId, unchangedFromPublished: isHistorical },
      publication: { selected: isHistorical ? item.publication : item.workflowStatus === 'published' ? item.publication : null, current: item.publication, history: item.publication ? [item.publication] : [] },
      history: history, synchronization: [demoSyncTarget(value, item, targetStatus)], sourceCorrection: item.sourceCorrection,
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
      if (method === 'GET' && url.pathname === '/api/v1/knowledge-management') {
        return jsonResponse({ success: true, data: demoKnowledgeList(value, url) });
      }
      if (method === 'GET' && url.pathname.indexOf('/api/v1/knowledge-management/items/') === 0) {
        var entryId = decodeURIComponent(url.pathname.slice('/api/v1/knowledge-management/items/'.length));
        var detail = demoKnowledgeDetail(value, entryId, url.searchParams.get('versionNumber'));
        return detail ? jsonResponse({ success: true, data: detail })
          : jsonResponse({ success: false, error: { code: 'knowledge_management_not_found', message: 'Demo knowledge item was not found.' } }, 404);
      }
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

  function readScenarioPreferences(value) {
    try {
      var stored = JSON.parse(global.sessionStorage.getItem(SCENARIO_PREFERENCES_KEY) || 'null');
      if (!stored || !value || !value.session || stored.sessionId !== value.session.id ||
          !stored.selection || typeof stored.selection !== 'object' || Array.isArray(stored.selection)) {
        return null;
      }
      return stored;
    } catch (_storageError) {
      return null;
    }
  }

  function writeScenarioPreferences(value, selection, open) {
    if (!value || !value.session || !value.session.id) return;
    try {
      global.sessionStorage.setItem(SCENARIO_PREFERENCES_KEY, JSON.stringify({
        sessionId: value.session.id,
        selection: selection,
        open: Boolean(open),
      }));
    } catch (_storageError) {}
  }

  function clearScenarioPreferences() {
    try { global.sessionStorage.removeItem(SCENARIO_PREFERENCES_KEY); } catch (_storageError) {}
  }

  function requestToolbarReturn(value) {
    try {
      global.sessionStorage.setItem(RETURN_TO_TOOLBAR_KEY, JSON.stringify({
        sessionId: value && value.session && value.session.id,
      }));
    } catch (_storageError) {}
  }

  function returnToToolbar(value) {
    if (!returnToToolbarRequested) return;
    var matchesSession = false;
    try {
      var requested = JSON.parse(global.sessionStorage.getItem(RETURN_TO_TOOLBAR_KEY) || 'null');
      matchesSession = Boolean(requested && value && value.session && requested.sessionId === value.session.id);
      global.sessionStorage.removeItem(RETURN_TO_TOOLBAR_KEY);
    } catch (_storageError) {}
    returnToToolbarRequested = false;
    if (!matchesSession) return;
    var toolbar = document.getElementById('northstarDemoToolbar');
    var summary = toolbar && toolbar.querySelector('summary');
    if (!toolbar || !summary) {
      global.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return;
    }
    var details = toolbar.querySelector('details');
    if (details) details.open = false;
    toolbar.scrollIntoView({ block: 'start', behavior: 'smooth' });
    summary.focus({ preventScroll: true });
    var announce = document.getElementById('northstarDemoStatus');
    if (announce) announce.textContent = 'Lead added. Your scenario choices are saved; the builder is ready for another run.';
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
            ? 'A new fictional demo workspace was created for this session.' : 'One demo lead was added across every demo destination.');
          if (intent === 'simulate-lead') {
            global.sessionStorage.setItem('northstarOnboardingSimulated', 'true');
            requestToolbarReturn(workspace);
          }
          if (intent === 'reset') clearScenarioPreferences();
        } catch (_storageError) {}
        var action = intent === 'reset' ? 'demo_reset' : 'demo_simulate_lead';
        global.dispatchEvent(new CustomEvent('northstar:interaction-complete', { detail: { action: action } }));
        if (intent === 'simulate-lead') global.dispatchEvent(new CustomEvent('northstar:demo-simulated'));
        global.location.reload();
      });
    }).catch(function (error) {
      status.textContent = error.message || 'The demo action could not be completed.';
      button.disabled = false;
      global.dispatchEvent(new CustomEvent('northstar:interaction-complete', {
        detail: { action: intent === 'reset' ? 'demo_reset' : 'demo_simulate_lead' },
      }));
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
    var metadata = control('span', 'Demo Data · ' + value.tenant.name + ' · Shared Across Every Demo Page', 'northstar-demo-toolbar-meta');
    metadata.id = 'northstarDemoRevision';
    copy.append(metadata);
    var builder = document.createElement('details');
    builder.className = 'northstar-demo-scenario-builder';
    var rememberedPreferences = readScenarioPreferences(value);
    builder.open = Boolean(rememberedPreferences && rememberedPreferences.open);
    var summary = control('summary', scenarioReady
      ? 'Build a lead scenario · ' + Number(scenarioSpace.combinationCount).toLocaleString() + ' material combinations'
      : 'Scenario builder unavailable');
    builder.appendChild(summary);
    var selections = Object.create(null);
    var scenarioGrid = control('div', '', 'northstar-demo-scenario-grid');
    var businessSummary = control('p', '', 'northstar-demo-business-summary');
    businessSummary.id = 'northstarDemoBusinessSummary';
    var guidedPresets = control('div', '', 'northstar-demo-presets');
    guidedPresets.setAttribute('aria-label', 'Guided demo scenarios');
    guidedPresets.appendChild(control('span', 'Quick scenarios', 'northstar-demo-presets-label'));
    var presetDefinitions = [
      { id: 'missed-call', label: 'Urgent missed-call recovery', selection: { business: 'growing_residential', service: 'plumbing', intent: 'repair_request', urgency: 'within_24_hours', context: 'new_customer', scheduling: 'flexible', outcome: 'follow_up' } },
      { id: 'high-value', label: 'High-value estimate', selection: { business: 'owner_operator', service: 'roofing', intent: 'new_estimate', urgency: 'planning', context: 'new_customer', scheduling: 'weekday_morning', outcome: 'estimate_ready' } },
      { id: 'schedule-conflict', label: 'Schedule conflict and follow-up', selection: { business: 'multi_crew', service: 'hvac', intent: 'repair_request', urgency: 'this_week', context: 'returning_customer', scheduling: 'after_hours', outcome: 'needs_information' } }
    ];
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
        var rememberedValue = rememberedPreferences && rememberedPreferences.selection[dimension.id];
        if (typeof rememberedValue === 'string' && dimension.options.some(function (definition) {
          return definition.id === rememberedValue;
        })) {
          select.value = rememberedValue;
        }
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
    if (scenarioReady) {
      presetDefinitions.forEach(function (preset) {
        var button = control('button', preset.label, 'northstar-demo-preset');
        button.type = 'button';
        button.dataset.preset = preset.id;
        button.addEventListener('click', function () {
          Object.keys(preset.selection).forEach(function (dimension) {
            if (!selections[dimension]) return;
            selections[dimension].value = preset.selection[dimension];
            selections[dimension].dispatchEvent(new Event('change', { bubbles: true }));
          });
          builder.open = true;
          writeScenarioPreferences(value, preset.selection, true);
          scenarioHelp.textContent = preset.label + ' is ready. Review any field, then simulate the lead.';
          var firstSelect = scenarioGrid.querySelector('select');
          if (firstSelect) firstSelect.focus();
        });
        guidedPresets.appendChild(button);
      });
    }
    builder.append(guidedPresets, scenarioGrid, businessSummary, scenarioHelp);
    var actions = control('div', '', 'northstar-demo-toolbar-actions');
    var simulate = control('button', 'Simulate Lead', 'btn btn-primary');
    simulate.id = 'demoSimulateLead';
    simulate.type = 'button';
    simulate.dataset.telemetryAction = 'demo_simulate_lead';
    simulate.setAttribute('data-telemetry-dead-click', '');
    simulate.disabled = !scenarioReady;
    var reset = control('button', 'Reset Demo', 'btn btn-secondary');
    reset.id = 'demoReset';
    reset.type = 'button';
    reset.dataset.telemetryAction = 'demo_reset';
    reset.setAttribute('data-telemetry-dead-click', '');
    var exit = control('a', 'Exit Demo', 'btn btn-ghost');
    exit.href = '/';
    exit.dataset.telemetryAction = 'demo_exit';
    actions.append(simulate, reset, exit);
    var status = control('p', '', 'northstar-demo-toolbar-status');
    status.id = 'northstarDemoStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    try {
      status.textContent = global.sessionStorage.getItem('northstarDemoNotice') ||
        'Every destination reads this same isolated demo workspace.';
      global.sessionStorage.removeItem('northstarDemoNotice');
    } catch (_storageError) {
      status.textContent = 'Every destination reads this same isolated demo workspace.';
    }
    section.append(copy, builder, actions, status);
    main.insertBefore(section, main.firstChild);
    returnToToolbar(value);
    var selectedScenario = function () {
      var selected = {};
      Object.keys(selections).forEach(function (dimension) { selected[dimension] = selections[dimension].value; });
      return selected;
    };
    var persistScenarioPreferences = function () {
      writeScenarioPreferences(value, selectedScenario(), builder.open);
    };
    builder.addEventListener('toggle', persistScenarioPreferences);
    Object.keys(selections).forEach(function (dimension) {
      selections[dimension].addEventListener('change', persistScenarioPreferences);
    });
    simulate.addEventListener('click', function () {
      var selected = selectedScenario();
      writeScenarioPreferences(value, selected, builder.open);
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
