'use strict';

const { v5: uuidv5 } = require('uuid');
const contract = require('../../public/js/command-center-contract');
const { sha256, stableValue } = require('../services/businessProfileAdapter');
const { projectIntegrationCatalogue } = require('../integrations/catalogue');
const { defaultPreferenceDocument, PROVIDERS: MAP_PROVIDERS } = require('../mapPreferences/contract');
const pipeline = require('../routes/simulation/pipeline');

const DEMO_NAMESPACE = '827bcc4d-601f-4d8b-9d3f-57570d942b11';
const DEMO_STATE_VERSION = 1;
const DEMO_CALCULATION_VERSION = 'command-center-demo-v1';
const DEMO_SERVICES = Object.freeze({
  fence: Object.freeze({ label: 'Fence installation', estimate: 6800 }),
  roofing: Object.freeze({ label: 'Roof replacement', estimate: 14800 }),
  hvac: Object.freeze({ label: 'HVAC service', estimate: 9600 }),
  plumbing: Object.freeze({ label: 'Plumbing service', estimate: 2850 }),
  electrical: Object.freeze({ label: 'Electrical service', estimate: 4250 }),
  concrete: Object.freeze({ label: 'Concrete installation', estimate: 11200 }),
});
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
  return contract.ROUTES.map(route => ({
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

function demoConfiguration() {
  return stableValue({
    immutableAcrossSimulation: true,
    businessProfile: {
      mode: 'fictional_read_only',
      company: 'Rivera Home Services',
      industry: 'Home services',
      serviceArea: 'A fictional 35-mile service area',
      hours: 'Monday-Friday, 8:00 AM-5:00 PM',
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
    },
    workforce: {
      mode: 'fictional_read_only',
      members: [
        { id: 'demo-owner', name: 'Maria Rivera', accessRole: 'owner', operationalRole: 'Owner' },
        { id: 'demo-dispatch', name: 'Sam Lee', accessRole: 'admin', operationalRole: 'Dispatcher' },
        { id: 'demo-crew', name: 'Alex Johnson', accessRole: 'member', operationalRole: 'Crew lead' },
      ],
      crews: [{ id: 'demo-crew-a', name: 'Crew A', lead: 'Alex Johnson', availability: 'Available tomorrow' }],
    },
    aiSettings: {
      mode: 'fictional_read_only',
      voiceStyle: 'Professional and concise',
      escalation: 'Transfer urgent calls to the on-call owner',
      providerConnection: 'Provider connection status is not represented in the account-free demo.',
    },
    myNumber: {
      mode: 'fictional_read_only',
      displayNumber: '(555) 010-0147',
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
    integrations: demoIntegrationCatalogue(),
  });
}

function normalizeFacts(scope, prefix) {
  return Object.keys(scope || {}).sort().slice(0, 16).map((field, index) => ({
    id: prefix + '-fact-' + String(index + 1),
    variable: field,
    status: 'collected',
    normalizedValue: stableValue(scope[field]),
    evidenceText: 'Fictional demo detail collected for ' + field + '.',
    speaker: 'customer',
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

function buildDemoGraph(input) {
  const ids = graphIds(input.tenantId, input.key);
  const createdAt = iso(input.createdAt);
  const facts = input.facts || normalizeFacts(input.scope, input.key);
  const lineItems = [
    { code: 'fictional-demo-scope', label: input.serviceLabel + ' scope', category: 'service', customerCharge: input.estimatedValue },
  ];
  const snapshot = {
    contract: 'DemoPolarisDetail',
    calculationVersion: DEMO_CALCULATION_VERSION,
    service: { key: input.serviceKey, label: input.serviceLabel, supported: true, scope: stableValue(input.scope || {}) },
    customerFacingPrice: input.estimatedValue,
    estimatedRevenue: input.estimatedValue,
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
    risk: { emergency: false, signal: null, evidence: null },
    recommendedActions: stableValue(input.recommendedActions),
    reasoning: stableValue(input.reasoning),
    notCalculated: [
      { field: 'knownDirectCosts', reason: 'The account-free demo does not represent a contractor\'s authoritative cost configuration.' },
      { field: 'netProfit', reason: 'Profit requires complete tenant-authored cost and overhead authority.' },
    ],
    supportingTranscriptFactIds: facts.map(fact => fact.id),
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
      fictional: true,
    },
    lead: {
      id: ids.lead,
      status: input.leadStatus,
      serviceType: input.serviceKey,
      serviceLabel: input.serviceLabel,
      summary: input.summary,
    },
    communication: {
      id: ids.communication,
      channel: 'voice',
      direction: 'inbound',
      subject: input.summary,
      transcript: stableValue(input.transcript || []),
    },
    work: {
      id: ids.work,
      status: input.workStatus,
      title: input.serviceLabel + ' estimate visit',
      scheduledStart: input.scheduledStart ? iso(input.scheduledStart) : null,
      assignedTo: input.assignedTo || null,
    },
    estimate: {
      id: ids.estimate,
      currency: 'USD',
      customerPrice: input.estimatedValue,
      lineItems,
      fictional: true,
    },
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

function initialGraphs(tenantId, createdAt) {
  return [
    buildDemoGraph({
      tenantId, key: 'seed-rivera', createdAt: shift(createdAt, -12 * 60 * 1000),
      customerName: 'Maria Rivera', phone: '(555) 010-0112', email: 'maria@example.demo',
      address: '48 Cedar Lane, Sample City, NC 28000', serviceKey: 'roofing', serviceLabel: 'Roof replacement',
      estimatedValue: 14800, confidence: 92, leadStatus: 'hot', workStatus: 'follow_up_due',
      scheduledStart: shift(createdAt, 26 * 60 * 60 * 1000), assignedTo: 'Crew A',
      summary: 'Storm-damage roof estimate requested after the fictional customer call.',
      scope: { jobType: 'replacement', squares: 28, material: 'architectural shingle', insuranceClaim: true },
      recommendedActions: [{ code: 'fast-follow-up', label: 'Call before 10 AM', priority: 'high' }],
      reasoning: ['Urgency and insurance readiness support a fast follow-up.', 'Crew A has a compatible opening tomorrow.'],
    }),
    buildDemoGraph({
      tenantId, key: 'seed-patel', createdAt: shift(createdAt, -38 * 60 * 1000),
      customerName: 'Dev Patel', phone: '(555) 010-0138', email: 'dev@example.demo',
      address: '910 Maple Way, Sample City, NC 28000', serviceKey: 'hvac', serviceLabel: 'HVAC service',
      estimatedValue: 9600, confidence: 88, leadStatus: 'booked', workStatus: 'scheduled',
      scheduledStart: shift(createdAt, 3 * 60 * 60 * 1000), assignedTo: 'Alex Johnson',
      summary: 'Replacement consultation booked for a fictional aging heat-pump system.',
      scope: { jobType: 'replacement', systemType: 'heat pump', tonnage: 3, timeline: 'this week' },
      recommendedActions: [{ code: 'prepare-estimate', label: 'Prepare the replacement estimate', priority: 'medium' }],
      reasoning: ['The complete system scope supports estimate preparation.', 'The requested visit is already scheduled.'],
    }),
    buildDemoGraph({
      tenantId, key: 'seed-lewis', createdAt: shift(createdAt, -26 * 60 * 60 * 1000),
      customerName: 'Avery Lewis', phone: '(555) 010-0191', email: 'avery@example.demo',
      address: '22 Oak Court, Sample City, NC 28000', serviceKey: 'electrical', serviceLabel: 'Electrical service',
      estimatedValue: 4250, confidence: 81, leadStatus: 'follow_up', workStatus: 'estimate_ready',
      scheduledStart: null, assignedTo: null,
      summary: 'Panel-upgrade estimate is ready for a fictional customer follow-up.',
      scope: { jobType: 'panel upgrade', amperage: 200, permitRequired: true, timeline: 'within one month' },
      recommendedActions: [{ code: 'confirm-financing', label: 'Confirm financing preference', priority: 'medium' }],
      reasoning: ['The requested scope is collected.', 'A financing preference remains unresolved.'],
    }),
  ];
}

function createInitialDemoState(tenantId, createdAt) {
  return stableValue({
    schemaVersion: DEMO_STATE_VERSION,
    createdAt: iso(createdAt),
    graphs: initialGraphs(tenantId, createdAt),
  });
}

function buildSimulatedGraph(input) {
  const service = DEMO_SERVICES[input.serviceKey];
  if (!service) {
    const error = new Error('A supported fictional demo scenario is required.');
    error.code = 'DEMO_SCENARIO_INVALID';
    error.status = 422;
    throw error;
  }
  const seed = sha256({ tenantId: input.tenantId, key: input.key, service: input.serviceKey });
  const nameIndex = Number.parseInt(seed.slice(0, 8), 16) % DEMO_CUSTOMER_NAMES.length;
  const customerName = DEMO_CUSTOMER_NAMES[nameIndex];
  const prepared = pipeline.withDeterministicSeed(seed, () => {
    const scenario = pipeline.generateScenario(input.serviceKey, customerName);
    const transcript = pipeline.generateTranscript(scenario);
    const extracted = pipeline.extractScope(transcript, scenario);
    return { scenario, transcript, extracted };
  });
  const scope = prepared.extracted.extracted;
  const evidence = prepared.extracted.evidence || {};
  const facts = Object.keys(scope).filter(field => evidence[field]).sort().map((field, index) => ({
    id: input.key + '-fact-' + String(index + 1),
    variable: field,
    status: 'collected',
    normalizedValue: stableValue(scope[field]),
    evidenceText: String(evidence[field]),
    speaker: 'customer',
    confidence: 1,
  }));
  const createdAt = iso(input.createdAt);
  return buildDemoGraph({
    tenantId: input.tenantId,
    key: input.key,
    createdAt,
    customerName,
    phone: prepared.scenario.customer.phone,
    email: prepared.scenario.customer.email,
    address: prepared.scenario.customer.address,
    serviceKey: input.serviceKey,
    serviceLabel: service.label,
    estimatedValue: service.estimate,
    confidence: 86,
    leadStatus: 'new',
    workStatus: 'triage',
    scheduledStart: shift(createdAt, 30 * 60 * 60 * 1000),
    assignedTo: null,
    summary: 'A new fictional ' + service.label.toLowerCase() + ' request entered the isolated demo workspace.',
    scope,
    transcript: prepared.transcript,
    facts,
    recommendedActions: [{ code: 'review-new-lead', label: 'Review the new lead and confirm the estimate visit', priority: 'high' }],
    reasoning: ['The fictional interaction supplied a customer identity and meaningful work scope.', 'The new record now drives every demo destination from this session state.'],
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
  const workspace = workspaceBase(
    'demo',
    { id: input.tenantId, name: 'Rivera Home Services', fictional: true, isolated: true },
    input.state.graphs,
    input.revision,
    demoConfiguration()
  );
  workspace.session = {
    id: input.sessionId,
    durable: Boolean(input.persisted),
    expiresAt: iso(input.expiresAt),
    simulationCount: input.simulationCount,
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
  return workspaceBase(
    'paid',
    { id: input.context.organizationId, name: 'Your NorthStar workspace', fictional: false, isolated: true },
    input.items.map(paidGraph),
    1,
    {
      source: 'mounted_paid_surfaces',
      note: 'Configuration remains on its role-authorized paid destination and is not copied into this projection.',
    }
  );
}

module.exports = {
  DEMO_CALCULATION_VERSION,
  DEMO_SERVICES,
  DEMO_STATE_VERSION,
  buildDemoWorkspace,
  buildPaidWorkspace,
  buildSimulatedGraph,
  createInitialDemoState,
  demoConfiguration,
  routeProjection,
  tenantIdFromTokenHash,
};
