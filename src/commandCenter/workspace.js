'use strict';

const { v5: uuidv5 } = require('uuid');
const contract = require('../../public/js/command-center-contract');
const { sha256, stableValue } = require('../services/businessProfileAdapter');
const { projectIntegrationCatalogue } = require('../integrations/catalogue');
const { defaultPreferenceDocument, PROVIDERS: MAP_PROVIDERS } = require('../mapPreferences/contract');
const pipeline = require('../routes/simulation/pipeline');
const {
  FIXTURE_CONTRACT,
  createDemoWorkspaceFixture,
  customerForSeed,
  normalizeDemoSeed,
} = require('./demoWorkspaceGenerator');
const {
  DEFAULT_SELECTION,
  DIMENSIONS: SCENARIO_DIMENSIONS,
  normalizeSelection,
  publicScenarioSpace,
  selectionProfile,
} = require('./scenarioSpace');

const DEMO_NAMESPACE = '827bcc4d-601f-4d8b-9d3f-57570d942b11';
const DEMO_STATE_VERSION = 2;
const DEMO_CALCULATION_VERSION = 'command-center-demo-v1';
const DEMO_SERVICES = Object.freeze(SCENARIO_DIMENSIONS.service.options.reduce((services, definition) => {
  services[definition.id] = Object.freeze({
    label: definition.label,
    estimate: definition.material.estimate,
  });
  return services;
}, {}));
const DEMO_CUSTOMER_NAMES = Object.freeze([
  'Jordan Blake', 'Taylor Morgan', 'Casey Nguyen', 'Riley Adams',
  'Cameron Brooks', 'Morgan Ellis', 'Avery Chen', 'Drew Martinez',
]);

function iso(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Demo Command Center time is invalid.');
  return parsed.toISOString();
}

function shift(value, milliseconds) {
  return new Date(new Date(value).getTime() + milliseconds).toISOString();
}

function id(tenantId, key) {
  return uuidv5(String(key), tenantId);
}

function tenantIdFromTokenHash(tokenHash) {
  if (!/^[0-9a-f]{64}$/.test(String(tokenHash || ''))) {
    throw new Error('Demo Command Center token digest is invalid.');
  }
  return uuidv5(String(tokenHash), DEMO_NAMESPACE);
}

function routeProjection(mode) {
  return contract.routesForMode(mode).map(route => ({
    id: route.id,
    label: route.label,
    href: mode === 'demo' ? route.demoPath : route.paidPath,
  }));
}

function demoIntegrationCatalogue() {
  return projectIntegrationCatalogue({
    authority: 'canonical_integration_ownership',
    connectors: [
      { provider: 'retell', status: 'not_provisioned' },
      { provider: 'voice', status: 'not_provisioned' },
    ],
  });
}

function demoBusinessProfile(selectionValue, seededWorkspace) {
  if (seededWorkspace && seededWorkspace.contract === FIXTURE_CONTRACT) {
    return stableValue(seededWorkspace.businessProfile);
  }
  const fallbackSelection = { ...DEFAULT_SELECTION, business: 'owner_operator' };
  const selection = normalizeSelection(selectionValue || fallbackSelection) || fallbackSelection;
  const profile = selectionProfile(selection);
  const business = profile.business;
  return stableValue({
    mode: 'fictional_read_only',
    businessKey: business.id,
    company: business.label,
    email: 'demo.office@example.com',
    phone: '(202) 555-0147',
    timeZone: 'America/New_York',
    industry: 'Home services',
    description: business.description,
    serviceArea: 'A demo ' + business.material.serviceRadiusMiles + '-mile service area',
    serviceRadiusMiles: business.material.serviceRadiusMiles,
    serviceZones: ['Central Example Zone'],
    headquarters: {
      street: '100 Example Service Way', city: 'Example Falls', state: 'NC', postalCode: '00000',
      country: 'US', timeZone: 'America/New_York', coordinates: { latitude: 35.65, longitude: -78.7 },
      fictional: true, formatted: '100 Example Service Way, Example Falls, NC 00000',
    },
    services: Object.keys(DEMO_SERVICES).map(function (key) {
      return { id: 'legacy-demo-service-' + key, key, label: DEMO_SERVICES[key].label, estimate: DEMO_SERVICES[key].estimate };
    }),
    crewCount: business.material.crewCount,
    pricingModel: business.material.pricingModel,
    hours: 'Monday-Friday, 8:00 AM-5:00 PM',
    ownerName: 'Avery Example',
    voiceAssistant: {
      name: 'NorthStar Office Manager',
      greeting: 'Thank you for calling ' + business.label + '. How can I help today?',
    },
    readiness: {
      state: 'needs_review',
      label: 'Review needed',
      guidance: 'Help Polaris understand your business. Polaris works best with a complete, accurate, and up-to-date Business Profile.',
      separation: 'Profile Readiness is separate from integration status and uses clear categories for recognized details.',
      items: [
        { label: 'Dispatch origin', state: 'reviewed' },
        { label: 'Service area', state: 'reviewed' },
        { label: 'Operating hours', state: 'reviewed' },
        { label: 'Customer guidance', state: 'needs_review' },
        { label: 'Financial configuration', state: 'needs_review' },
        { label: 'Voice assistant configuration', state: 'needs_review' },
      ],
    },
  });
}

function demoConfiguration(selectionValue, seededWorkspace) {
  const seeded = seededWorkspace && seededWorkspace.contract === FIXTURE_CONTRACT
    ? seededWorkspace : null;
  const businessProfile = demoBusinessProfile(selectionValue, seeded);
  return stableValue({
    immutableAcrossSimulation: Boolean(seeded),
    scenarioSpace: publicScenarioSpace(),
    businessProfile,
    workforce: seeded ? seeded.team : {
      mode: 'fictional_read_only',
      members: [
        { id: 'demo-owner', name: 'Avery Example', email: 'avery.example@example.com', phone: '(202) 555-0102', accessRole: 'owner', operationalRole: 'Owner', fictional: true },
        { id: 'demo-dispatch', name: 'Casey Sample', email: 'casey.sample@example.com', phone: '(202) 555-0103', accessRole: 'admin', operationalRole: 'Dispatcher', fictional: true },
        { id: 'demo-crew', name: 'Jordan Fixture', email: 'jordan.fixture@example.com', phone: '(202) 555-0104', accessRole: 'member', operationalRole: 'Crew lead', fictional: true },
      ],
      crews: [{ id: 'demo-crew-a', name: 'Example Crew A', lead: 'Jordan Fixture', availability: 'Available tomorrow' }],
    },
    aiSettings: {
      mode: 'fictional_read_only',
      voiceStyle: 'Professional and concise',
      escalation: 'Transfer urgent calls to the on-call owner',
      providerConnection: 'Provider connection status is not represented in the account-free demo.',
    },
    myNumber: {
      mode: 'fictional_read_only',
      displayNumber: seeded ? seeded.company.phone : '(202) 555-0147',
      status: 'Fictional preview number - no calls are placed or received.',
    },
    settings: {
      mode: 'fictional_read_only',
      notifications: { dailyBrief: true, urgentLead: true, scheduleChange: true },
      maps: {
        providers: MAP_PROVIDERS,
        effective: defaultPreferenceDocument(),
        note: 'Apple Maps, Google Maps, and Waze are preferences only. The demo does not launch destinations or establish provider connections.',
      },
    },
    workspaceAuthority: seeded ? {
      contract: seeded.contract,
      territory: seeded.territory,
      services: seeded.services,
    } : null,
    integrations: demoIntegrationCatalogue(),
  });
}

function normalizeFacts(scope, prefix) {
  return Object.keys(scope || {}).sort().slice(0, 16).map((field, index) => ({
    id: prefix + '-fact-' + String(index + 1),
    variable: field,
    status: 'collected',
    normalizedValue: stableValue(scope[field]),
    evidenceText: 'Demo record detail collected for ' + field + '.',
    speaker: 'system',
    evidenceSource: 'demo_record',
    confidence: 1,
  }));
}

function graphIds(tenantId, key) {
  return {
    graph: id(tenantId, key + ':graph'),
    operation: id(tenantId, key + ':operation'),
    customer: id(tenantId, key + ':customer'),
    lead: id(tenantId, key + ':lead'),
    opportunity: id(tenantId, key + ':lead'),
    communication: id(tenantId, key + ':communication'),
    work: id(tenantId, key + ':work'),
    appointment: id(tenantId, key + ':work'),
    estimate: id(tenantId, key + ':estimate'),
    polarisSnapshot: id(tenantId, key + ':polaris'),
  };
}

function demoViewerId(tenantId) {
  return id(tenantId, 'account-free-demo-viewer');
}

function demoTranscriptText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  const turns = value.map(function (line) {
    if (typeof line === 'string') return { speaker: 'system', text: line };
    if (!line || typeof line !== 'object') return null;
    const text = String(line.text || line.content || line.message || '').trim();
    if (!text) return null;
    return {
      speaker: String(line.speaker || line.role || 'system').trim().toLowerCase(),
      text,
    };
  }).filter(Boolean);
  return turns.length ? JSON.stringify(turns) : '';
}

function demoCanonicalItem(tenantId, graph, configuration) {
  if (!graph || !graph.ids || !graph.polaris || !graph.polaris.snapshot) {
    throw new Error('Demo canonical graph is malformed.');
  }
  const createdAt = iso(graph.timestamps && graph.timestamps.createdAt);
  const updatedAt = iso(graph.timestamps && (graph.timestamps.updatedAt || graph.timestamps.createdAt));
  const occurredAt = iso(graph.timestamps && (graph.timestamps.communicationOccurredAt || graph.timestamps.createdAt));
  const transcriptId = id(tenantId, graph.ids.graph + ':transcript');
  const rawFacts = Array.isArray(graph.polaris.facts) ? graph.polaris.facts : [];
  const facts = rawFacts.map(function (fact, index) {
    const canonicalFact = {
      id: id(tenantId, graph.ids.graph + ':fact:' + String(index + 1)),
      ordinal: index,
      variable: String(fact && fact.variable || 'demo_fact_' + String(index + 1)),
      status: String(fact && fact.status || 'collected'),
      normalizedValue: stableValue(fact && Object.prototype.hasOwnProperty.call(fact, 'normalizedValue')
        ? fact.normalizedValue : null),
      evidenceText: String(fact && fact.evidenceText || 'Fictional demo evidence.'),
      speaker: String(fact && fact.speaker || 'customer'),
      confidence: Number.isFinite(Number(fact && fact.confidence)) ? Number(fact.confidence) : 1,
      createdAt,
    };
    canonicalFact.factFingerprint = sha256({
      variable: canonicalFact.variable,
      normalizedValue: canonicalFact.normalizedValue,
      evidenceText: canonicalFact.evidenceText,
      speaker: canonicalFact.speaker,
      ordinal: canonicalFact.ordinal,
    });
    return canonicalFact;
  });
  const businessProfile = graph.businessProfile || configuration && configuration.businessProfile || {};
  const businessProfileKey = String(businessProfile.businessKey || 'owner_operator');
  const businessProfileAuthorityId = id(tenantId, 'demo-business-profile:' + businessProfileKey);
  const businessProfileInputHash = sha256(businessProfile);
  const transcriptText = demoTranscriptText(graph.communication && graph.communication.transcript);
  const timestamps = {
    operationClaimedAt: createdAt,
    operationCreatedAt: createdAt,
    operationCompletedAt: createdAt,
    operationUpdatedAt: updatedAt,
    customerCreatedAt: createdAt,
    customerUpdatedAt: updatedAt,
    transcriptOccurredAt: occurredAt,
    transcriptCreatedAt: createdAt,
    communicationOccurredAt: occurredAt,
    communicationCreatedAt: createdAt,
    opportunityCreatedAt: createdAt,
    opportunityUpdatedAt: updatedAt,
    estimateCreatedAt: createdAt,
    appointmentCreatedAt: createdAt,
    appointmentUpdatedAt: updatedAt,
    snapshotCreatedAt: createdAt,
  };
  const canonical = {
    readModelVersion: 'canonical-polaris-read-model-v1',
    legacy: false,
    ids: {
      operation: graph.ids.operation,
      graph: graph.ids.graph,
      customer: graph.ids.customer,
      transcript: transcriptId,
      communication: graph.ids.communication,
      opportunity: graph.ids.opportunity || graph.ids.lead,
      estimate: graph.ids.estimate,
      appointment: graph.ids.appointment || graph.ids.work,
      polarisSnapshot: graph.ids.polarisSnapshot,
      facts: facts.map(function (fact) { return fact.id; }),
    },
    source: {
      type: 'account_free_demo',
      version: String(graph.source && graph.source.version || DEMO_STATE_VERSION),
      externalCustomerId: null,
      externalCallId: null,
      externalTranscriptId: null,
      externalCommunicationId: null,
      externalAppointmentId: null,
    },
    customer: {
      id: graph.ids.customer,
      name: graph.customer && graph.customer.name || null,
      email: graph.customer && graph.customer.email || null,
      phone: graph.customer && graph.customer.phone || null,
      address: graph.customer && graph.customer.address || null,
      location: graph.customer && graph.customer.location || null,
    },
    transcript: {
      id: transcriptId,
      text: transcriptText,
      occurredAt,
      durationSeconds: null,
    },
    communication: {
      id: graph.ids.communication,
      channel: graph.communication && graph.communication.channel || 'voice',
      direction: graph.communication && graph.communication.direction || 'inbound',
      subject: graph.communication && graph.communication.subject || null,
    },
    opportunity: {
      id: graph.ids.opportunity || graph.ids.lead,
      status: graph.lead && graph.lead.status || 'new',
      serviceType: graph.lead && graph.lead.serviceType || null,
      scope: graph.polaris.snapshot.service && graph.polaris.snapshot.service.scope || {},
      appointmentPreference: null,
    },
    estimate: {
      id: graph.ids.estimate,
      currency: graph.estimate && graph.estimate.currency || 'USD',
      customerPrice: graph.estimate && graph.estimate.customerPrice,
      lineItems: graph.estimate && graph.estimate.lineItems || [],
    },
    appointment: {
      id: graph.ids.appointment || graph.ids.work,
      preference: null,
      scheduledStart: graph.work && graph.work.scheduledStart || null,
      scheduledEnd: null,
      status: graph.work && graph.work.status || 'preferred',
      timeZone: graph.work && graph.work.timeZone || null,
    },
    facts,
    calculationVersion: graph.polaris.calculationVersion || DEMO_CALCULATION_VERSION,
    normalizedInputFingerprint: sha256({ graph: graph.ids.graph, snapshot: graph.polaris.snapshot }),
    businessProfileInputVersion: '1',
    businessProfileInputHash,
    businessProfileAuthorityId,
    supportingTranscriptFactIds: facts.filter(function (_fact, index) {
      return rawFacts[index] && rawFacts[index].evidenceSource === 'transcript';
    }).map(function (fact) { return fact.id; }),
    snapshotDigest: graph.polaris.snapshotDigest,
    snapshot: stableValue(graph.polaris.snapshot),
    snapshotCreatedAt: createdAt,
    timestamps,
    metadata: {
      operationState: 'completed',
      operationPayloadFingerprint: sha256({ graph: graph.ids.graph, source: 'account_free_demo' }),
      transcriptFingerprint: sha256(transcriptText),
    },
  };
  canonical.projectionDigest = sha256({
    readModelVersion: canonical.readModelVersion,
    ids: canonical.ids,
    source: canonical.source,
    facts: canonical.facts,
    normalizedInputFingerprint: canonical.normalizedInputFingerprint,
    supportingTranscriptFactIds: canonical.supportingTranscriptFactIds,
    calculationVersion: canonical.calculationVersion,
    snapshotDigest: canonical.snapshotDigest,
    timestamps: canonical.timestamps,
    metadata: canonical.metadata,
    businessProfile: {
      id: canonical.businessProfileAuthorityId,
      version: canonical.businessProfileInputVersion,
      hash: canonical.businessProfileInputHash,
    },
  });
  return canonical;
}

function demoCanonicalItems(workspace) {
  if (!workspace || !workspace.tenant || !Array.isArray(workspace.graphs)) {
    throw new Error('Demo workspace is malformed.');
  }
  return workspace.graphs.map(function (graph) {
    return demoCanonicalItem(workspace.tenant.id, graph, workspace.configuration);
  });
}

function buildDemoGraph(input) {
  const ids = graphIds(input.tenantId, input.key);
  const createdAt = iso(input.createdAt);
  const facts = input.facts || normalizeFacts(input.scope, input.key);
  const lineItems = [
    { code: 'fictional-demo-scope', label: input.serviceLabel + ' scope', category: 'service', customerCharge: input.estimatedValue },
  ];
  const snapshot = {
    contract: 'CanonicalPolarisOutput',
    calculationVersion: DEMO_CALCULATION_VERSION,
    service: { key: input.serviceKey, label: input.serviceLabel, supported: true, scope: stableValue(input.scope || {}) },
    customerFacingPrice: input.estimatedValue,
    estimatedRevenue: input.estimatedValue,
    grossProfit: null,
    grossMarginPercent: null,
    netProfit: null,
    netMarginPercent: null,
    preliminaryRange: {
      low: Math.round(input.estimatedValue * 0.9),
      high: Math.round(input.estimatedValue * 1.1),
    },
    pricingLineItems: lineItems,
    confidence: {
      score: input.confidence,
      factors: [
        { factor: 'fictionalDemoScope', value: true },
        { factor: 'supportingFacts', value: facts.length },
        { factor: 'roleAuthorizedDetail', value: true },
      ],
    },
    risk: stableValue(input.risk || { emergency: false, signal: null, evidence: null }),
    recommendedActions: stableValue(input.recommendedActions),
    reasoning: stableValue(input.reasoning),
    missingInformation: stableValue(input.missingInformation || []),
    notCalculated: [
      { field: 'knownDirectCosts', reason: 'The account-free demo does not represent a contractor\'s authoritative cost configuration.' },
      { field: 'netProfit', reason: 'Profit requires complete tenant-authored cost and overhead authority.' },
    ],
    supportingTranscriptFactIds: facts.filter(fact => fact.evidenceSource === 'transcript').map(fact => fact.id),
  };
  const snapshotDigest = sha256(snapshot);
  const graph = {
    ids,
    source: { type: 'account_free_demo', version: DEMO_STATE_VERSION },
    customer: {
      id: ids.customer,
      name: input.customerName,
      phone: input.phone,
      email: input.email,
      address: input.address,
      location: stableValue(input.customerLocation || null),
      context: input.customerContext || null,
      fictional: true,
    },
    lead: {
      id: ids.lead,
      status: input.leadStatus,
      serviceType: input.serviceKey,
      serviceLabel: input.serviceLabel,
      summary: input.summary,
      callerIntent: input.callerIntent || null,
      urgency: input.urgency || null,
      outcome: input.outcome || null,
    },
    communication: {
      id: ids.communication,
      channel: 'voice',
      direction: 'inbound',
      subject: input.summary,
      intent: input.callerIntent || null,
      transcript: stableValue(input.transcript || []),
    },
    work: {
      id: ids.work,
      status: input.workStatus,
      title: input.serviceLabel + ' estimate visit',
      scheduledStart: input.scheduledStart ? iso(input.scheduledStart) : null,
      assignedTo: input.assignedTo || null,
      schedulingConstraint: input.schedulingConstraint || null,
      timeZone: input.timeZone || input.businessProfile && input.businessProfile.timeZone || null,
    },
    estimate: {
      id: ids.estimate,
      currency: 'USD',
      customerPrice: input.estimatedValue,
      lineItems,
      fictional: true,
    },
    scenario: stableValue(input.scenario || null),
    businessProfile: stableValue(input.businessProfile || demoBusinessProfile()),
    polaris: {
      id: ids.polarisSnapshot,
      calculationVersion: DEMO_CALCULATION_VERSION,
      snapshotDigest,
      snapshot,
      facts,
      completeDetail: true,
      fictional: true,
    },
    timestamps: {
      createdAt,
      updatedAt: createdAt,
      communicationOccurredAt: createdAt,
      snapshotCreatedAt: createdAt,
    },
  };
  graph.projectionDigest = sha256(graph);
  return graph;
}

function initialGraphs(seededWorkspace, createdAt) {
  const customers = new Map(seededWorkspace.customers.map(customer => [customer.id, customer]));
  return seededWorkspace.jobs.map(function (job, index) {
    const customer = customers.get(job.customerId);
    if (!customer) throw new Error('A seeded demo job has no fictional customer authority.');
    return buildDemoGraph({
      tenantId: seededWorkspace.tenant.id,
      key: 'seeded-job-' + job.id,
      createdAt: shift(createdAt, -(12 + index * 26) * 60 * 1000),
      customerName: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address.formatted,
      customerLocation: customer.address,
      serviceKey: job.serviceKey,
      serviceLabel: job.serviceLabel,
      estimatedValue: job.estimatedValue,
      confidence: job.confidence,
      leadStatus: job.leadStatus,
      workStatus: job.workStatus,
      scheduledStart: job.scheduledStart,
      assignedTo: job.assignedTo,
      timeZone: job.timeZone,
      summary: job.summary,
      scope: {
        ...job.scope,
        serviceRadiusMiles: seededWorkspace.territory.radiusMiles,
        customerDistanceMiles: customer.address.distanceMiles,
        serviceZone: customer.address.serviceZone,
        timeZone: job.timeZone,
      },
      recommendedActions: [{ code: 'review-fictional-job', label: 'Review the fictional job and confirm the next step.', priority: index === 0 ? 'high' : 'medium' }],
      reasoning: [
        'The service request matches the fictional workspace service catalogue.',
        'The customer location is inside the configured fictional service radius.',
      ],
      businessProfile: seededWorkspace.businessProfile,
    });
  });
}

function createInitialDemoState(tenantId, createdAt, options = {}) {
  const input = typeof options === 'string' ? { seed: options } : options || {};
  const sourceSeed = typeof input.seed === 'string' && input.seed
    ? input.seed : 'container-tenant:' + String(tenantId);
  const seed = normalizeDemoSeed(sourceSeed);
  const seededWorkspace = createDemoWorkspaceFixture({ seed: sourceSeed, anchorTime: createdAt });
  const generation = Number.isSafeInteger(input.generation) && input.generation >= 1
    ? input.generation : 1;
  return stableValue({
    schemaVersion: DEMO_STATE_VERSION,
    createdAt: iso(createdAt),
    generation,
    seed,
    workspace: seededWorkspace,
    graphs: initialGraphs(seededWorkspace, createdAt),
  });
}

function buildSimulatedGraph(input) {
  const fallbackSelection = input && input.serviceKey
    ? { ...DEFAULT_SELECTION, service: input.serviceKey }
    : null;
  const selection = normalizeSelection(input && (input.scenarioSelection || fallbackSelection));
  const profile = selectionProfile(selection);
  const service = profile && DEMO_SERVICES[selection.service];
  if (!service || !profile) {
    const error = new Error('A supported fictional demo scenario is required.');
    error.code = 'DEMO_SCENARIO_INVALID';
    error.status = 422;
    throw error;
  }
  const seededWorkspace = input && input.workspace && input.workspace.contract === FIXTURE_CONTRACT
    ? input.workspace : null;
  const seed = sha256({ tenantId: input.tenantId, key: input.key, scenario: selection });
  const nameIndex = Number.parseInt(seed.slice(0, 8), 16) % DEMO_CUSTOMER_NAMES.length;
  const fictionalCustomer = seededWorkspace
    ? customerForSeed(seededWorkspace, seed, Number.parseInt(seed.slice(0, 4), 16) % 1000)
    : null;
  const customerName = fictionalCustomer ? fictionalCustomer.name : DEMO_CUSTOMER_NAMES[nameIndex];
  const serviceRadiusMiles = seededWorkspace
    ? seededWorkspace.territory.radiusMiles : profile.business.material.serviceRadiusMiles;
  const distanceTenths = 10 + (
    Number.parseInt(seed.slice(8, 16), 16) % Math.max(1, serviceRadiusMiles * 10 - 9)
  );
  const customerDistanceMiles = fictionalCustomer
    ? fictionalCustomer.address.distanceMiles : distanceTenths / 10;
  const prepared = pipeline.withDeterministicSeed(seed, () => {
    const scenario = pipeline.generateScenario(selection.service, customerName);
    if (fictionalCustomer) {
      scenario.customer.phone = fictionalCustomer.phone;
      scenario.customer.email = fictionalCustomer.email;
      scenario.customer.address = fictionalCustomer.address.formatted;
    }
    scenario.job.scope.callerIntent = selection.intent;
    scenario.job.scope.urgency = selection.urgency;
    scenario.job.scope.customerContext = selection.context;
    scenario.job.scope.schedulingConstraint = selection.scheduling;
    scenario.job.scope.conversationOutcome = selection.outcome;
    scenario.job.scope.businessContext = selection.business;
    const transcript = pipeline.generateTranscript(scenario);
    transcript.splice(2, 0,
      { speaker: 'ai', text: 'What outcome would be most useful from this call?' },
      { speaker: 'customer', text: profile.intent.material.customerLine },
      { speaker: 'ai', text: 'How quickly does the team need to respond?' },
      { speaker: 'customer', text: profile.urgency.material.customerLine },
      { speaker: 'ai', text: 'Is there customer, property, or access context we should account for?' },
      { speaker: 'customer', text: profile.context.label + '. ' + profile.scheduling.material.customerLine },
      { speaker: 'ai', text: 'What should happen after we confirm the scope?' },
      { speaker: 'customer', text: profile.outcome.material.customerLine }
    );
    const extracted = pipeline.extractScope(transcript, scenario);
    return { scenario, transcript, extracted };
  });
  const scope = stableValue({
    ...(prepared.extracted.extracted || {}),
    businessContext: profile.business.label,
    callerIntent: profile.intent.label,
    urgency: profile.urgency.label,
    customerContext: profile.context.label,
    schedulingConstraint: profile.scheduling.label,
    conversationOutcome: profile.outcome.label,
    serviceRadiusMiles,
    customerDistanceMiles,
    crewCount: seededWorkspace ? seededWorkspace.team.crews.length : profile.business.material.crewCount,
    pricingModel: seededWorkspace
      ? seededWorkspace.businessProfile.pricingModel : profile.business.material.pricingModel,
  });
  const evidence = {
    ...(prepared.extracted.evidence || {}),
    businessContext: 'Selected scenario template: ' + profile.business.description,
    callerIntent: profile.intent.material.customerLine,
    urgency: profile.urgency.material.customerLine,
    customerContext: profile.context.description,
    schedulingConstraint: profile.scheduling.material.customerLine,
    conversationOutcome: profile.outcome.material.customerLine,
    serviceRadiusMiles: 'Business Profile service radius: ' + serviceRadiusMiles + ' miles.',
    customerDistanceMiles: 'Calculated distance from the selected business origin: ' + customerDistanceMiles + ' miles.',
    crewCount: 'Business Profile field crew count: ' +
      (seededWorkspace ? seededWorkspace.team.crews.length : profile.business.material.crewCount) + ' crew' +
      ((seededWorkspace ? seededWorkspace.team.crews.length : profile.business.material.crewCount) === 1 ? '.' : 's.'),
    pricingModel: 'Business Profile pricing model: ' +
      (seededWorkspace ? seededWorkspace.businessProfile.pricingModel : profile.business.material.pricingModel) + '.',
  };
  const businessProfileFields = new Set(['serviceRadiusMiles', 'crewCount', 'pricingModel']);
  const scenarioFields = new Set(['businessContext']);
  const calculatedFields = new Set(['customerDistanceMiles']);
  const facts = Object.keys(scope).filter(field => evidence[field]).sort().map((field, index) => {
    const evidenceSource = businessProfileFields.has(field)
      ? 'business_profile'
      : scenarioFields.has(field) ? 'scenario_selection'
        : calculatedFields.has(field) ? 'calculation' : 'transcript';
    return {
      id: input.key + '-fact-' + String(index + 1),
      variable: field,
      status: 'collected',
      normalizedValue: stableValue(scope[field]),
      evidenceText: String(evidence[field]),
      speaker: evidenceSource === 'transcript' ? 'customer' : 'system',
      evidenceSource,
      confidence: 1,
    };
  });
  const createdAt = iso(input.createdAt);
  const visitOffset = Math.min(
    profile.urgency.material.hoursUntilVisit,
    profile.scheduling.material.dayOffset * 24 + Math.max(1, profile.scheduling.material.hour - 8)
  );
  const scheduledStart = ['booked'].includes(selection.outcome)
    ? shift(createdAt, visitOffset * 60 * 60 * 1000)
    : null;
  const missingInformation = [profile.context.material.missing];
  if (selection.outcome === 'needs_information') {
    missingInformation.push('One material scope or approval input must be confirmed before scheduling.');
  }
  const priorityAction = {
    code: 'scenario-' + selection.outcome,
    label: profile.outcome.material.action,
    priority: profile.urgency.material.priority,
  };
  const assignableMembers = seededWorkspace
    ? seededWorkspace.team.members.filter(member => member.accessRole === 'member') : [];
  const assignedMember = assignableMembers.length
    ? assignableMembers[Number.parseInt(seed.slice(16, 24), 16) % assignableMembers.length]
    : null;
  return buildDemoGraph({
    tenantId: input.tenantId,
    key: input.key,
    createdAt,
    customerName,
    phone: fictionalCustomer ? fictionalCustomer.phone : prepared.scenario.customer.phone,
    email: fictionalCustomer ? fictionalCustomer.email : prepared.scenario.customer.email,
    address: fictionalCustomer ? fictionalCustomer.address.formatted : prepared.scenario.customer.address,
    customerLocation: fictionalCustomer ? fictionalCustomer.address : null,
    serviceKey: selection.service,
    serviceLabel: service.label,
    estimatedValue: service.estimate,
    confidence: profile.outcome.material.confidence,
    leadStatus: profile.outcome.material.leadStatus,
    workStatus: profile.outcome.material.workStatus,
    scheduledStart,
    assignedTo: assignedMember ? assignedMember.name : profile.business.material.assignedTo,
    timeZone: seededWorkspace ? seededWorkspace.territory.timeZone : null,
    summary: profile.intent.label + ' for ' + service.label.toLowerCase() +
      ' with ' + profile.urgency.label.toLowerCase() + ' urgency; outcome: ' +
      profile.outcome.label.toLowerCase() + '.',
    scope,
    transcript: prepared.transcript,
    facts,
    recommendedActions: [
      priorityAction,
      { code: 'capacity-check', label: 'Confirm ' + profile.business.material.capacityLabel.toLowerCase() + ' capacity.', priority: 'medium' },
    ],
    reasoning: [
      profile.urgency.description,
      profile.business.material.capacityRisk,
      'The selected customer, scheduling, and outcome context now drives every demo destination from this session state.',
    ],
    risk: {
      emergency: profile.urgency.material.emergency,
      signal: profile.urgency.label,
      evidence: profile.urgency.material.customerLine,
    },
    missingInformation,
    customerContext: profile.context.label,
    callerIntent: profile.intent.label,
    urgency: profile.urgency.label,
    outcome: profile.outcome.label,
    schedulingConstraint: profile.scheduling.label,
    businessProfile: demoBusinessProfile(selection, seededWorkspace),
    scenario: {
      contract: 'northstar_demo_scenario_selection_v1',
      signature: profile.signature,
      selection,
      labels: {
        business: profile.business.label,
        service: profile.service.label,
        intent: profile.intent.label,
        urgency: profile.urgency.label,
        context: profile.context.label,
        scheduling: profile.scheduling.label,
        outcome: profile.outcome.label,
      },
      businessFactors: {
        workspaceCompany: seededWorkspace ? seededWorkspace.company.name : profile.business.label,
        scenarioTemplate: profile.business.label,
        serviceRadiusMiles,
        customerDistanceMiles,
        crewCount: seededWorkspace ? seededWorkspace.team.crews.length : profile.business.material.crewCount,
        pricingModel: seededWorkspace
          ? seededWorkspace.businessProfile.pricingModel : profile.business.material.pricingModel,
        withinServiceRadius: customerDistanceMiles <= serviceRadiusMiles,
      },
    },
  });
}

function workspaceBase(mode, tenant, graphs, revision, configuration) {
  const capabilities = mode === 'demo'
    ? { simulateLead: true, reset: true, scenarioControls: true, realTenantData: false }
    : { realTenantData: true };
  const value = {
    contract: contract.WORKSPACE_CONTRACT,
    contractVersion: contract.CONTRACT_VERSION,
    mode,
    tenant: stableValue(tenant),
    navigation: routeProjection(mode),
    capabilities,
    graphs: stableValue(graphs),
    configuration: stableValue(configuration),
    integrity: {
      revision,
      graphCount: graphs.length,
      digest: '',
    },
  };
  value.integrity.digest = sha256({
    contract: value.contract,
    contractVersion: value.contractVersion,
    mode: value.mode,
    tenant: value.tenant,
    navigation: value.navigation,
    capabilities: value.capabilities,
    graphs: value.graphs,
    configuration: value.configuration,
    revision,
  });
  return value;
}

function buildDemoWorkspace(input) {
  const seededWorkspace = input && input.state && input.state.workspace &&
    input.state.workspace.contract === FIXTURE_CONTRACT ? input.state.workspace : null;
  const activeScenarioGraph = input.state.graphs.find(graph =>
    graph && graph.scenario && graph.scenario.selection && normalizeSelection(graph.scenario.selection));
  const activeSelection = activeScenarioGraph ? activeScenarioGraph.scenario.selection : null;
  const configuration = demoConfiguration(activeSelection, seededWorkspace);
  const tenant = seededWorkspace ? seededWorkspace.tenant : {
    id: input.tenantId,
    name: configuration.businessProfile.company,
    businessProfileKey: configuration.businessProfile.businessKey,
    fictional: true,
    isolated: true,
  };
  const workspace = workspaceBase(
    'demo',
    tenant,
    input.state.graphs,
    input.revision,
    configuration
  );
  workspace.session = {
    id: input.sessionId,
    durable: Boolean(input.persisted),
    expiresAt: iso(input.expiresAt),
    simulationCount: input.simulationCount,
    workspaceGeneration: Number.isSafeInteger(input.state.generation) ? input.state.generation : 1,
    lifecycle: {
      contract: 'new_session_or_explicit_reset_v1',
      newSessionCreatesWorkspace: true,
      resetCreatesWorkspace: true,
      navigationPreservesWorkspace: true,
      reloadPreservesWorkspace: true,
    },
  };
  workspace.viewer = {
    id: demoViewerId(tenant.id),
    label: 'Account-free demo visitor',
  };
  return workspace;
}

function paidGraph(item) {
  return {
    ids: { ...item.ids, lead: item.ids.opportunity, work: item.ids.appointment },
    source: item.source,
    customer: item.customer,
    lead: { ...item.opportunity, id: item.ids.opportunity },
    communication: { ...item.communication, transcript: item.transcript },
    work: { ...item.appointment, id: item.ids.appointment, title: item.snapshot && item.snapshot.service && item.snapshot.service.label },
    estimate: item.estimate,
    polaris: {
      id: item.ids.polarisSnapshot,
      calculationVersion: item.calculationVersion,
      snapshotDigest: item.snapshotDigest,
      snapshot: item.snapshot,
      facts: item.facts,
      completeDetail: true,
      fictional: false,
    },
    timestamps: item.timestamps,
    projectionDigest: item.projectionDigest,
  };
}

function buildPaidWorkspace(input) {
  if (!input || !input.context || !input.context.organizationId || !Array.isArray(input.items) ||
      input.items.some(item => !item || !item.source || typeof item.source.type !== 'string' ||
        ['simulation', 'demo'].includes(item.source.type.toLowerCase()))) {
    throw new Error('The paid Command Center requires real tenant projections.');
  }
  const workspace = workspaceBase(
    'paid',
    { id: input.context.organizationId, name: 'Your NorthStar workspace', fictional: false, isolated: true },
    input.items.map(paidGraph),
    1,
    {
      source: 'mounted_paid_surfaces',
      note: 'Configuration remains on its role-authorized paid destination and is not copied into this projection.',
    }
  );
  if (input.schedulingOperator && input.schedulingOverview) {
    workspace.schedulingOperator = stableValue(input.schedulingOperator);
    workspace.schedulingOverview = stableValue(input.schedulingOverview);
    workspace.integrity.digest = sha256({
      workspaceDigest: workspace.integrity.digest,
      schedulingOperatorDigest: workspace.schedulingOperator.digest,
      schedulingOverviewDigest: workspace.schedulingOverview.digest,
    });
  }
  return workspace;
}

module.exports = {
  DEMO_CALCULATION_VERSION,
  DEMO_SERVICES,
  DEMO_STATE_VERSION,
  buildDemoWorkspace,
  buildPaidWorkspace,
  buildSimulatedGraph,
  createInitialDemoState,
  demoCanonicalItems,
  demoConfiguration,
  demoViewerId,
  routeProjection,
  tenantIdFromTokenHash,
};
