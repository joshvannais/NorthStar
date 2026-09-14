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
  var readonlyMessage = 'This action is not available in the demo. Existing demo scheduling and review tools remain available.';
  var SCENARIO_PREFERENCES_KEY = 'northstarDemoScenarioPreferences';
  var RETURN_TO_TOOLBAR_KEY = 'northstarDemoReturnToToolbar';
  var returnToToolbarRequested = false;
  var requestedScrollRestoration = 'auto';
  var scrollRestorationTimer = null;

  function ownToolbarScrollRestoration(restoreMode) {
    if (!global.history || !('scrollRestoration' in global.history)) return;
    requestedScrollRestoration = restoreMode === 'manual' ? 'manual' : 'auto';
    global.history.scrollRestoration = 'manual';
    if (scrollRestorationTimer) global.clearTimeout(scrollRestorationTimer);
    scrollRestorationTimer = global.setTimeout(restoreToolbarScrollMode, 2000);
  }

  function restoreToolbarScrollMode() {
    if (scrollRestorationTimer) global.clearTimeout(scrollRestorationTimer);
    scrollRestorationTimer = null;
    if (global.history && 'scrollRestoration' in global.history) {
      global.history.scrollRestoration = requestedScrollRestoration;
    }
  }

  try {
    var storedToolbarReturn = JSON.parse(global.sessionStorage.getItem(RETURN_TO_TOOLBAR_KEY) || 'null');
    returnToToolbarRequested = Boolean(storedToolbarReturn);
    var navigationEntry=global.performance&&global.performance.getEntriesByType('navigation')[0];
    if(navigationEntry&&navigationEntry.type==='reload'&&!returnToToolbarRequested)global.sessionStorage.setItem('northstarDemoDraftRefresh','true');
    if (returnToToolbarRequested) {
      ownToolbarScrollRestoration(storedToolbarReturn.scrollRestoration);
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
    if(value.configuration.workforceProjection)return {data:value.configuration.workforceProjection};
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

  var operationsReads=new Map(),operationsRequests=new Map();
  function ownerReadFetch(url,options) {
    // Establish the shared account-free session before concurrent owner reads.
    return loadWorkspace(false).then(function(){return nativeFetch(url,options);});
  }
  function transport(input, options) {
    var url = requestPath(input);
    var method = methodOf(options, input);
    if (url.origin !== global.location.origin) {
      return Promise.resolve(jsonResponse({ error: readonlyMessage, code: 'demo_external_request_blocked' }, 403));
    }
    if (url.pathname.indexOf('/api/demo/') === 0) return nativeFetch(input, options);
    if(method==='GET'&&url.pathname==='/api/v1/operational-overview')return ownerReadFetch('/api/demo/command-center/operations/overview'+url.search,options);
    var ownerRead=/^\/api\/v1\/field-executions\/owner-work(?:\/appointments\/([a-f0-9-]+))?$/.exec(url.pathname);
    if(method==='GET'&&ownerRead)return ownerReadFetch('/api/demo/command-center/operations'+(ownerRead[1]?'/appointments/'+ownerRead[1]:''),options);
    var ownerReview=/^\/api\/v1\/field-executions\/([a-f0-9-]+)\/completion-review$/.exec(url.pathname);
    if(method==='GET'&&ownerReview)return ownerReadFetch('/api/demo/command-center/operations/executions/'+ownerReview[1]+'/completion-review',options).then(async function(response){
      if(response.ok){var envelope=await response.clone().json();operationsReads.set(ownerReview[1],{appointmentId:envelope.data.execution.appointmentId,revision:envelope.demoWorkspaceRevision});}return response;
    });
    var ownerDecision=/^\/api\/v1\/field-executions\/([a-f0-9-]+)\/completion-actions$/.exec(url.pathname);
    if(method==='POST'&&ownerDecision){
      var h=new Headers(options&&options.headers||{}),k=h.get('Idempotency-Key'),basis=operationsRequests.get(k)||operationsReads.get(ownerDecision[1]);
      if(!basis)return Promise.resolve(jsonResponse({success:false,error:{message:'Refresh the completion review before deciding.'}},409));
      if(!operationsRequests.has(k)){if(operationsRequests.size>=64)return Promise.resolve(jsonResponse({success:false,error:{message:'Reload this page before starting another decision.'}},429));operationsRequests.set(k,basis);}
      h.set('X-NorthStar-Demo-Intent','owner-operations');h.set('X-NorthStar-Demo-Revision',String(basis.revision));
      return nativeFetch('/api/demo/command-center/operations/appointments/'+basis.appointmentId+'/actions',Object.assign({},options,{headers:h,body:JSON.stringify({family:'completion',body:JSON.parse(options.body)})}));
    }

    if(method==='GET'&&url.pathname==='/api/v1/canonical/operator-targets')return nativeFetch('/api/demo/command-center/operator-targets'+url.search,Object.assign({},options||{},{credentials:'same-origin'}));
    var scheduleTimes=/^\/api\/v1\/canonical\/appointments\/([a-f0-9-]+)\/(mutation-previews|mutation-approvals)$/.exec(url.pathname);
    if(method==='POST'&&scheduleTimes){
      var scheduleHeaders=new Headers(options&&options.headers||{});scheduleHeaders.set('X-NorthStar-Demo-Intent','schedule-times');
      return nativeFetch('/api/demo/command-center/appointments/'+encodeURIComponent(scheduleTimes[1])+'/'+scheduleTimes[2],Object.assign({},options||{},{headers:scheduleHeaders,credentials:'same-origin'})).then(function(response){
        // Invalidate only after a successful persisted operation. Existing UI
        // consent keeps its captured pin; no latest-state substitution here.
        if(response.ok){workspaceRequest=null;workspace=null;}
        return response;
      });
    }

    var adoption = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/(material-adoptions|material-adoption-preview|cost-adoptions|cost-adoption-preview)$/.exec(url.pathname);
    if(method==='POST'&&adoption){var adoptionHeaders=new Headers(options&&options.headers||{});adoptionHeaders.set('X-NorthStar-Demo-Intent','material-adoption');return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(adoption[1])+'/'+adoption[2],Object.assign({},options||{},{headers:adoptionHeaders,credentials:'same-origin'}));}
    var commercialPlan=/^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/(commercial-terms|commercial-preview|commercial-approvals)$/.exec(url.pathname);
    if(method==='POST'&&commercialPlan){var commercialHeaders=new Headers(options&&options.headers||{});commercialHeaders.set('X-NorthStar-Demo-Intent','commercial-terms');return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(commercialPlan[1])+'/'+commercialPlan[2],Object.assign({},options||{},{headers:commercialHeaders,credentials:'same-origin'}));}
    if(url.pathname==='/api/v1/business-profile/tax-preparation'&&['GET','POST'].indexOf(method)>=0){var taxHeaders=new Headers(options&&options.headers||{});if(method==='POST')taxHeaders.set('X-NorthStar-Demo-Intent','tax-preparation');return loadWorkspace().then(function(){return nativeFetch('/api/demo/command-center/tax-preparation',Object.assign({},options||{},{headers:taxHeaders,credentials:'same-origin'}));});}
    var policyPlan = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/(pricing-policies|pricing-policy-preview)$/.exec(url.pathname);
    if(method==='POST'&&policyPlan){var pricingHeaders=new Headers(options&&options.headers||{});pricingHeaders.set('X-NorthStar-Demo-Intent','pricing-policy');return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(policyPlan[1])+'/'+policyPlan[2],Object.assign({},options||{},{headers:pricingHeaders,credentials:'same-origin'}));}
    var prepared = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/proposal-preview$/.exec(url.pathname);
    if(method==='POST'&&prepared){var preparedHeaders=new Headers(options&&options.headers||{});preparedHeaders.set('X-NorthStar-Demo-Intent','proposal-preview');return loadWorkspace().then(function(){return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(prepared[1])+'/proposal-preview',Object.assign({},options||{},{headers:preparedHeaders,credentials:'same-origin'}));});}
    var scenario = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/capella-scenarios$/.exec(url.pathname);
    if(method==='POST'&&scenario){var scenarioHeaders=new Headers(options&&options.headers||{});scenarioHeaders.set('X-NorthStar-Demo-Intent','capella-scenarios');return loadWorkspace().then(function(){return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(scenario[1])+'/capella-scenarios'+url.search,Object.assign({},options||{},{headers:scenarioHeaders,credentials:'same-origin'}));});}
    var pricingPlan = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/(pricing-plans|pricing-plan-preview)$/.exec(url.pathname);
    if(method==='POST'&&pricingPlan){var pricingHeaders=new Headers(options&&options.headers||{});pricingHeaders.set('X-NorthStar-Demo-Intent','pricing-plan');return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(pricingPlan[1])+'/'+pricingPlan[2],Object.assign({},options||{},{headers:pricingHeaders,credentials:'same-origin'}));}
    var travelPlan = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/(travel-plans|travel-plan-preview)$/.exec(url.pathname);
    if(method==='POST'&&travelPlan){var travelHeaders=new Headers(options&&options.headers||{});travelHeaders.set('X-NorthStar-Demo-Intent','travel-plan');return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(travelPlan[1])+'/'+travelPlan[2],Object.assign({},options||{},{headers:travelHeaders,credentials:'same-origin'}));}
    var laborPlan = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/(labor-plans|labor-plan-preview)$/.exec(url.pathname);
    if(method==='POST'&&laborPlan){var planHeaders=new Headers(options&&options.headers||{});planHeaders.set('X-NorthStar-Demo-Intent','labor-plan');return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(laborPlan[1])+'/'+laborPlan[2],Object.assign({},options||{},{headers:planHeaders,credentials:'same-origin'}));}
    var equipmentReadiness = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/(equipment-readiness-plans|equipment-readiness-preview)$/.exec(url.pathname);
    if(method==='POST'&&equipmentReadiness){var readinessHeaders=new Headers(options&&options.headers||{});readinessHeaders.set('X-NorthStar-Demo-Intent','equipment-readiness');return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(equipmentReadiness[1])+'/'+equipmentReadiness[2],Object.assign({},options||{},{headers:readinessHeaders,credentials:'same-origin'}));}
    var equipmentReadiness = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/(equipment-readiness-plans|equipment-readiness-preview)$/.exec(url.pathname);
    if(method==='POST'&&equipmentReadiness){var readinessHeaders=new Headers(options&&options.headers||{});readinessHeaders.set('X-NorthStar-Demo-Intent','equipment-readiness');return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(equipmentReadiness[1])+'/'+equipmentReadiness[2],Object.assign({},options||{},{headers:readinessHeaders,credentials:'same-origin'}));}
    var equipmentCost = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/(equipment-cost-plans|equipment-cost-preview)$/.exec(url.pathname);
    if(method==='POST'&&equipmentCost){var costHeaders=new Headers(options&&options.headers||{});costHeaders.set('X-NorthStar-Demo-Intent','equipment-cost');return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(equipmentCost[1])+'/'+equipmentCost[2],Object.assign({},options||{},{headers:costHeaders,credentials:'same-origin'}));}
    var equipmentPlan = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/(equipment-plans|equipment-plan-preview)$/.exec(url.pathname);
    if(method==='POST'&&equipmentPlan){var planHeaders=new Headers(options&&options.headers||{});planHeaders.set('X-NorthStar-Demo-Intent','equipment-plan');return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(equipmentPlan[1])+'/'+equipmentPlan[2],Object.assign({},options||{},{headers:planHeaders,credentials:'same-origin'}));}
    var materialPlan = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/(material-plans|material-plan-preview)$/.exec(url.pathname);
    if(method==='POST'&&materialPlan){var planHeaders=new Headers(options&&options.headers||{});planHeaders.set('X-NorthStar-Demo-Intent','material-plan');return nativeFetch('/api/demo/command-center/estimates/'+encodeURIComponent(materialPlan[1])+'/'+materialPlan[2],Object.assign({},options||{},{headers:planHeaders,credentials:'same-origin'}));}
    var estimateDecision = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/decisions$/.exec(url.pathname);
    if (method === 'POST' && estimateDecision) {
      var decisionHeaders = new Headers(options && options.headers || {});
      decisionHeaders.set('X-NorthStar-Demo-Intent','estimate-decision');
      return nativeFetch('/api/demo/command-center/estimates/' + encodeURIComponent(estimateDecision[1]) + '/decisions',
        Object.assign({},options||{},{headers:decisionHeaders,credentials:'same-origin'}));
    }
    var estimateReview = /^\/api\/v1\/canonical\/estimates\/([a-f0-9-]+)\/review$/.exec(url.pathname);
    if (method === 'GET' && estimateReview) {
      return nativeFetch('/api/demo/command-center/estimates/' + encodeURIComponent(estimateReview[1]) + '/review' + url.search,
        Object.assign({}, options || {}, { credentials: 'same-origin' }));
    }

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
    if (url.pathname === '/dashboard/completion-review') return '/demo/completion-review' + url.search + url.hash;
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

  function writeScenarioPreferences(value, selection, open, extra) {
    if (!value || !value.session || !value.session.id) return;
    try {
      global.sessionStorage.setItem(SCENARIO_PREFERENCES_KEY, JSON.stringify({
        sessionId: value.session.id,
        version: extra && extra.version, generation: extra && extra.generation, resolved: extra && extra.resolved,
        selection: selection,
        open: Boolean(open),
      }));
    } catch (_storageError) {}
  }

  function clearScenarioPreferences() {
    try { global.sessionStorage.removeItem(SCENARIO_PREFERENCES_KEY); } catch (_storageError) {}
  }

  function requestToolbarReturn(value, action) {
    var currentScrollRestoration = global.history && 'scrollRestoration' in global.history
      ? global.history.scrollRestoration : 'auto';
    try {
      global.sessionStorage.setItem(RETURN_TO_TOOLBAR_KEY, JSON.stringify({
        sessionId: value && value.session && value.session.id,
        action: action || 'simulate-lead',
        scrollRestoration: currentScrollRestoration === 'manual' ? 'manual' : 'auto',
      }));
      ownToolbarScrollRestoration(currentScrollRestoration);
    } catch (_storageError) {
      restoreToolbarScrollMode();
    }
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
    if (!matchesSession) {
      restoreToolbarScrollMode();
      return;
    }
    var toolbar = document.getElementById('northstarDemoToolbar');
    var summary = toolbar && toolbar.querySelector('summary');
    if (!toolbar || !summary) {
      global.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      global.setTimeout(restoreToolbarScrollMode, 500);
      return;
    }
    var details = toolbar.querySelector('details');
    if (details) details.open = false;
    summary.focus({ preventScroll: true });
    var positionToolbar = function () {
      if (!toolbar.isConnected) return;
      toolbar.scrollIntoView({ block: 'start', behavior: 'auto' });
    };
    positionToolbar();
    global.requestAnimationFrame(function () {
      positionToolbar();
      global.requestAnimationFrame(positionToolbar);
    });
    [50, 150, 350].forEach(function (delay) {
      global.setTimeout(positionToolbar, delay);
    });
    global.setTimeout(restoreToolbarScrollMode, 500);
    var announce = document.getElementById('northstarDemoStatus');
    if (announce) announce.textContent = requested&&requested.action==='reset'?'A new demo is ready.':'Lead added. Your choices are ready for another lead.';
  }

  function performMutation(endpoint, intent, body, button, status) {
    var toolbar=document.getElementById('northstarDemoToolbar');
    var attempt=button._demoAttempt || {headers:mutationHeaders(intent),body:JSON.stringify(body)};
    if(!button._demoAttempt)try {attempt.preferences=global.sessionStorage.getItem(SCENARIO_PREFERENCES_KEY);}catch(_){}
    button._demoAttempt=attempt;
    try {global.sessionStorage.setItem('northstarDemoPendingAction',JSON.stringify({sessionId:workspace.session.id,endpoint:endpoint,intent:intent,attempt:attempt}));}catch(_){}
    var controls=toolbar?Array.from(toolbar.querySelectorAll('button,select')):[];
    controls.forEach(function(c){c.disabled=true;});
    button.disabled = true;
    status.textContent = intent==='reset'?'Starting a new demo…':'Adding your simulated lead…';
    return nativeFetch(endpoint, {
      method: 'POST', credentials: 'same-origin', headers: attempt.headers, body: attempt.body,
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.success !== true || !payload.data) {
          var rejection=new Error('The demo action could not be completed.');
          rejection.status=response.status;rejection.code=payload&&payload.error&&payload.error.code;throw rejection;
        }
        workspace = payload.data;
        try {global.sessionStorage.removeItem('northstarDemoPendingAction');}catch(_){}
        try {
          global.sessionStorage.setItem('northstarSessionId', workspace.session.id);
          global.sessionStorage.setItem('northstarDemoNotice', intent === 'reset'
            ? 'A new fictional demo workspace was created for this session.' : 'One demo lead was added across every demo destination.');
          if (intent === 'simulate-lead') {
            if(attempt.preferences)global.sessionStorage.setItem(SCENARIO_PREFERENCES_KEY,attempt.preferences);
            global.sessionStorage.setItem('northstarOnboardingSimulated', 'true');
            requestToolbarReturn(workspace);
          }
          if (intent === 'reset') { clearScenarioPreferences(); requestToolbarReturn(workspace, 'reset'); }
        } catch (_storageError) {}
        var action = intent === 'reset' ? 'demo_reset' : 'demo_simulate_lead';
        global.dispatchEvent(new CustomEvent('northstar:interaction-complete', { detail: { action: action } }));
        if (intent === 'simulate-lead') global.dispatchEvent(new CustomEvent('northstar:demo-simulated'));
        global.location.reload();
      });
    }).catch(function (error) {
      var known=[400,401,403,404,409,410,413,422,429].indexOf(error.status)>=0;
      if(known){button._demoAttempt=null;try {global.sessionStorage.removeItem('northstarDemoPendingAction');}catch(_){} }
      if(error.code==='DEMO_SIMULATION_LIMIT')status.textContent='This demo has reached its 12-lead limit. Saved work is retained. Reset Demo starts over.';
      else if(error.status===409||error.status===410)status.textContent='This demo changed or expired. Refresh before trying again. Check saved work before starting over.';
      else if(error.status===429)status.textContent='The demo cannot accept this action now. Your saved work is retained. Try again later.';
      else if(known)status.textContent='This action was not accepted. Review your choices or refresh the demo.';
      else status.textContent='The result is uncertain. Check saved leads before trying again, or retry this same action.';
      if(known&&error.status!==409&&error.status!==410)controls.forEach(function(c){c.disabled=false;});
      if(known&&button.dataset.restoredRetry==='true'){
        button.disabled=true;button.remove();
        var next=toolbar.querySelector(intent==='reset'?'#demoReset':'#demoSimulateLead');
        if(error.code==='DEMO_SIMULATION_LIMIT'&&next)next.disabled=true;
        if(next&&!next.disabled)next.focus();
      }
      if(!known){button.textContent='Retry Same Action';button.disabled=false;}
      if(error.code==='DEMO_SIMULATION_LIMIT')button.disabled=true;
      global.dispatchEvent(new CustomEvent('northstar:interaction-complete', {
        detail: { action: intent === 'reset' ? 'demo_reset' : 'demo_simulate_lead' },
      }));
    });
  }

  function installToolbar(value) {
    if (document.getElementById('northstarDemoToolbar') || TOOLBAR_EXCLUDED_PATHS.indexOf(path) >= 0) return;
    var main=document.querySelector('.main-content'), space=value.configuration&&value.configuration.scenarioSpace;
    var resolver=global.NorthStarCommandCenterContract&&global.NorthStarCommandCenterContract.resolveDemoScenario;
    if(!main)return;
    var section=control('section','','northstar-demo-toolbar compact-demo'), identity=control('div','','northstar-demo-identity');
    section.id='northstarDemoToolbar';section.setAttribute('aria-label','Demo controls');
    identity.append(control('strong',value.tenant.name),control('span','Demo','northstar-demo-badge'));
    var actions=control('div','','northstar-demo-toolbar-actions'),simulate=control('button','Simulated Lead','btn btn-primary'),builder=document.createElement('details'),summary=control('summary','Customize','btn btn-secondary'),reset=control('button','Reset Demo','btn btn-secondary');
    simulate.id='demoSimulateLead';simulate.type=reset.type='button';reset.id='demoReset';builder.className='northstar-demo-scenario-builder';builder.append(summary);
    var panel=control('div','','northstar-demo-customize-panel'),grid=control('div','','northstar-demo-scenario-grid'),help=control('p','Reload the page to prepare a new lead. Saved demo work stays until Reset Demo.','northstar-demo-scenario-help'),status=control('p','','northstar-demo-toolbar-status');
    status.id='northstarDemoStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    var choices={},resolved=null,selects={},remembered=readScenarioPreferences(value),nav=global.performance&&global.performance.getEntriesByType('navigation')[0];
    var returned=false;try {var marker=JSON.parse(global.sessionStorage.getItem(RETURN_TO_TOOLBAR_KEY)||'null');returned=!!(marker&&marker.sessionId===value.session.id);}catch(_){}
    var generation=value.session.workspaceGeneration,compatible=remembered&&remembered.version===2&&remembered.generation===generation;
    var fresh=nav&&nav.type==='reload'&&!returned;
    try {fresh=fresh||global.sessionStorage.getItem('northstarDemoDraftRefresh')==='true';global.sessionStorage.removeItem('northstarDemoDraftRefresh');}catch(_){}
    var business=space&&space.defaultSelection&&space.defaultSelection.business;
    var active=value.graphs&&value.graphs.find(function(g){return g.scenario&&g.scenario.selection;});if(active)business=active.scenario.selection.business;
    choices.business=business;
    var labels={service:'Service Request',intent:'Caller Intent',urgency:'Urgency',context:'Customer Context',scheduling:'Scheduling',outcome:'Outcome'};
    function persist(){writeScenarioPreferences(value,choices,false,{resolved:resolved,generation:generation,version:2});}
    function resolve(previous){resolved=resolver&&resolver(space,choices,Math.random,previous);persist();simulate.disabled=!resolved||value.session.simulationCount>=12;var problem='Choose compatible lead details or use Random.';
      if(choices.service!=='random'&&choices.intent!=='random'&&!global.NorthStarCommandCenterContract.demoJobType(choices.service,choices.intent,null))problem='That service does not support this caller intent in the demo. Choose another intent.';
      else if(choices.scheduling==='weather_window'&&choices.service!=='random'&&['fence','roofing','concrete'].indexOf(choices.service)<0)problem='Weather-dependent timing is available for outdoor services. Choose another timing option.';
      else if(choices.urgency==='safety_emergency')problem='An emergency needs a repair or supported inspection request, flexible timing and more information.';
      status.textContent=!resolved?problem:value.session.simulationCount>=12?'This demo has reached its 12-lead limit. Saved work is retained. Reset Demo starts over.':'';}
    if(space&&resolver)space.dimensions.forEach(function(d){if(!labels[d.id])return;choices[d.id]=compatible&&!fresh?remembered.selection[d.id]||'random':'random';var field=control('div','','northstar-demo-scenario-field'),label=control('label',labels[d.id]),select=document.createElement('select');select.id='demoScenario-'+d.id;label.htmlFor=select.id;var random=control('option','Random');random.value='random';select.append(random);d.options.forEach(function(o){var opt=control('option',o.label);opt.value=o.id;select.append(opt);});select.value=choices[d.id];if(!select.value)select.value=choices[d.id]='random';selects[d.id]=select;field.append(label,select);grid.append(field);select.addEventListener('change',function(){choices[d.id]=select.value;resolve(null);});});
    if(compatible&&!fresh&&remembered.resolved&&resolver(space,remembered.resolved,function(){return 0;},null))resolved=remembered.resolved;
    if(!resolved)resolve(compatible?remembered.resolved:null);else persist();
    simulate.disabled=!resolved||value.session.simulationCount>=12;
    if(value.session.simulationCount>=12)status.textContent='This demo has reached its 12-lead limit. Saved work is retained. Reset Demo starts over.';
    panel.append(control('strong','Customize Lead'),grid,help);builder.append(panel);builder.addEventListener('keydown',function(e){if(e.key==='Escape'){builder.open=false;summary.focus();e.preventDefault();}});
    actions.append(simulate,builder,reset);section.append(identity,actions,status);main.insertBefore(section,main.firstChild);
    var confirm=control('div','','northstar-demo-reset-confirm');confirm.hidden=true;confirm.setAttribute('role','group');confirm.setAttribute('aria-label','Confirm demo reset');var cancel=control('button','Cancel','btn btn-secondary'),proceed=control('button','Reset And Start Over','btn btn-secondary');cancel.type=proceed.type='button';confirm.append(control('p','Start over with a new demo business? This removes this demo session’s saved leads, estimates and work history.'),cancel,proceed);section.append(confirm);
    reset.addEventListener('click',function(){confirm.hidden=false;cancel.focus();});cancel.addEventListener('click',function(){confirm.hidden=true;reset.focus();});confirm.addEventListener('keydown',function(e){if(e.key==='Escape'){cancel.click();e.preventDefault();}});
    simulate.addEventListener('click',function(){if(!resolved)return;persist();performMutation('/api/demo/command-center/simulations/leads','simulate-lead',{scenario:resolved,expectedRevision:workspace.integrity.revision},simulate,status);});
    proceed.addEventListener('click',function(){performMutation('/api/demo/command-center/reset','reset',{expectedRevision:workspace.integrity.revision},proceed,status);});
    returnToToolbar(value);
    try {
      var pending=JSON.parse(global.sessionStorage.getItem('northstarDemoPendingAction')||'null');
      if(pending&&pending.sessionId===value.session.id&&pending.attempt&&typeof pending.attempt.body==='string'&&pending.attempt.headers&&
        ((pending.intent==='simulate-lead'&&pending.endpoint==='/api/demo/command-center/simulations/leads')||(pending.intent==='reset'&&pending.endpoint==='/api/demo/command-center/reset'))){
        var retry=control('button','Retry Same Action','btn btn-secondary');retry.type='button';retry.dataset.restoredRetry='true';retry._demoAttempt=pending.attempt;
        section.querySelectorAll('button,select').forEach(function(c){c.disabled=true;});status.textContent='An earlier action has an uncertain result. Check saved leads or retry that same action.';
        section.append(retry);retry.addEventListener('click',function(){if(retry._demoAttempt)performMutation(pending.endpoint,pending.intent,{},retry,status);});
      }else if(pending)global.sessionStorage.removeItem('northstarDemoPendingAction');
    }catch(_){}
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
