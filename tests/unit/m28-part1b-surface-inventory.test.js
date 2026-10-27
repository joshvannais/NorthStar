'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const INVENTORY_PATH = 'docs/architecture/MISSION_28_PART1B_SURFACE_INVENTORY.json';
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART1B_AUTOMATION_SURFACE_INVENTORY.md';
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';
const BASE = '21ca719e24382443bbf3f52e460f3c16b016c4ad';
const BASE_TREE = '0cfdc4f0e8dc28c790893edff7bbebe0b31a5d10';

const DISPOSITIONS = [
  'mission28_owned_reusable_after_later_authority',
  'upstream_or_subscription_owned_excluded',
  'simulated_or_demo_only',
  'legacy_unsupported_or_quarantined',
  'manual_handoff',
  'ambiguous_fail_closed',
];

const FACETS = [
  'cron_job', 'worker', 'queue', 'event_listener', 'notification', 'email_sms_path',
  'native_share_or_composer_handoff', 'reminder', 'retry', 'collection_label',
  'webhook', 'template', 'provider_adapter', 'demo_action', 'manual_quick_send',
];

const WORKER_PATHS = [
  'src/commandCenter/demoRepository.js',
  'src/email/outbox.js',
  'src/estimating/taxPreparationWorker.js',
  'src/estimating/taxResearchWorker.js',
  'src/knowledge/synchronizationWorker.js',
  'src/services/capacityAdvisoryContinuationWorker.js',
  'src/services/homepageDemoAdmission.js',
  'src/support/outbox.js',
];

const BUSINESS_EVENT_PATHS = [
  'public/js/app-store.js',
  'public/js/canonical-intelligence.js',
  'public/js/communications-engine.js',
  'public/js/event-bus.js',
  'public/js/notification-service.js',
  'public/js/retell-provider.js',
  'public/js/simulator.js',
  'src/voice/businessEvents.js',
  'src/voice/eventIntelligence.js',
  'src/voice/transcriptStream.js',
  'src/voice/webhook.js',
];

const BROWSER_EVENT_PRODUCER_PATHS = [
  'public/js/app-store.js',
  'public/js/calendar-engine.js',
  'public/js/canonical-intelligence.js',
  'public/js/communications-engine.js',
  'public/js/notification-service.js',
  'public/js/retell-provider.js',
  'public/js/simulator.js',
];

const BROWSER_EVENT_LISTENER_PATHS = [
  'public/dashboard/calendar.html',
  'public/dashboard/communications.html',
  'public/dashboard/leads.html',
  'public/dashboard/polaris.html',
  'public/js/app-store.js',
  'public/js/communications-engine.js',
  'public/js/notification-service.js',
  'public/js/polaris-engine.js',
];

const SIMULATOR_CONSUMER_PATHS = [
  'public/dashboard.html',
  'public/dashboard/calendar.html',
  'public/dashboard/communications.html',
  'public/dashboard/leads.html',
];

const PAID_SIMULATION_WRITE_PATHS = [
  'public/dashboard.html',
  'public/js/polaris-api.js',
  'src/routes/simulation/pipeline.js',
  'src/routes/simulations.js',
  'src/server.js',
  'src/services/canonicalGraphService.js',
];

const LEGACY_WORKFLOW_PATHS = [
  'src/polaris/communications-engine.js',
  'src/polaris/workflow-engine.js',
];

const NOTIFICATION_PREFERENCE_PATHS = [
  'src/accounts/repository.js',
  'src/routes/account.js',
  'src/routes/api.js',
];

const LEGACY_VOICE_AUTOMATION_PATHS = [
  'src/voice/callCompletion.js',
  'src/voice/humanHandoff.js',
  'src/voice/toolRegistry.js',
];

const PROVIDER_IMPLEMENTATION_PATHS = [
  'public/js/retell-provider.js',
  'src/browser/retellWebEntry.mjs',
  'src/calendar/client.js',
  'src/email/transactional.js',
  'src/equipment/provider.js',
  'src/estimating/taxSourceTransport.js',
  'src/integrations/jobber.js',
  'src/knowledge/providerBindings.js',
  'src/knowledge/retellProjectionTransport.js',
  'src/notifications/email.js',
  'src/notifications/sms.js',
  'src/polaris/openaiRuntime.js',
  'src/retell/client.js',
  'src/sheets/client.js',
];

const PROVIDER_IMPORT_CONSUMER_PATHS = [
  'src/accounts/service.js',
  'src/estimating/taxSourceBinding.js',
  'src/forecasting/retellCallReconciliation.js',
  'src/knowledge/providerBindings.js',
  'src/routes/api.js',
  'src/routes/jobberIntegration.js',
  'src/server.js',
  'src/services/canonicalVoiceSessionCreation.js',
  'src/services/homepageWebCall.js',
  'src/support/outbox.js',
  'src/workforce/repository.js',
  'src/workforce/service.js',
];

const OPENAI_POLARIS_PROVIDER_CHAIN_PATHS = [
  'src/polaris/assistantRuntime.js',
  'src/polaris/callGenerationBinding.js',
  'src/polaris/demoGrounded.js',
  'src/polaris/openaiRuntime.js',
  'src/polaris/providerLedger.js',
  'src/routes/canonicalPolaris.js',
  'src/routes/connectedCall.js',
  'src/routes/demo.js',
  'src/server.js',
];

const CUSTOMER_ESTIMATE_HANDOFF_PATHS = [
  'public/customer-estimate.html',
  'public/js/customer-estimate-preview.js',
  'public/js/customer-estimate-public.js',
  'src/estimating/customerEstimateDeliveryContract.js',
  'src/estimating/customerEstimateDeliveryHttpBoundary.js',
  'src/estimating/customerEstimateDeliveryRepository.js',
  'src/routes/canonicalPolaris.js',
  'src/routes/customerEstimateDelivery.js',
  'src/routes/demo.js',
  'src/server.js',
];

const MISSION27_PAYMENT_PROVIDER_LIFECYCLE_PATHS = [
  'src/customerFinancial/paymentProviderBoundary.js',
  'src/customerFinancial/paymentProviderBoundaryRepository.js',
  'src/customerFinancial/paymentProviderConnection.js',
  'src/customerFinancial/paymentProviderConnectionRepository.js',
  'src/customerFinancial/paymentProviderEventNormalization.js',
  'src/customerFinancial/paymentProviderEventNormalizationRepository.js',
  'src/customerFinancial/paymentProviderEventReceipt.js',
  'src/customerFinancial/paymentProviderEventReceiptRepository.js',
  'src/customerFinancial/providerLifecycleAcceptance.js',
  'src/customerFinancial/providerLifecycleAcceptanceHttpBoundary.js',
  'src/customerFinancial/providerLifecycleAcceptanceRepository.js',
  'src/customerFinancial/providerLifecycleHealth.js',
  'src/customerFinancial/providerLifecycleHealthHttpBoundary.js',
  'src/customerFinancial/providerLifecycleHealthRepository.js',
  'src/customerFinancial/providerLifecycleRecovery.js',
  'src/customerFinancial/providerLifecycleRecoveryHttpBoundary.js',
  'src/customerFinancial/providerLifecycleRecoveryRepository.js',
  'src/customerFinancial/providerLifecycleRetention.js',
  'src/customerFinancial/providerLifecycleRetentionHttpBoundary.js',
  'src/customerFinancial/providerLifecycleRetentionRepository.js',
  'src/middleware/providerLifecycleAcceptanceBoundary.js',
  'src/middleware/providerLifecycleHealthBoundary.js',
  'src/middleware/providerLifecycleRecoveryBoundary.js',
  'src/middleware/providerLifecycleRetentionBoundary.js',
  'src/routes/customerFinancialPaymentProvider.js',
  'src/routes/customerFinancialProviderAcceptance.js',
  'src/routes/customerFinancialProviderConnection.js',
  'src/routes/customerFinancialProviderEventNormalization.js',
  'src/routes/customerFinancialProviderEventReceipt.js',
  'src/routes/customerFinancialProviderLifecycle.js',
  'src/routes/customerFinancialProviderRecovery.js',
  'src/routes/customerFinancialProviderRetention.js',
  'src/server.js',
];

const RETELL_WEBHOOK_REPLAY_CHAIN_PATHS = [
  'src/routes/retellWebhookBoundary.js',
  'src/voice/webhook.js',
  'src/retell/webhookReplayAuthority.js',
];

const PROVIDER_IMPLEMENTATION_SIGNAL =
  /require\(['"](?:node:https|https|twilio|nodemailer|googleapis|openai)['"]\)|from ['"]retell-client-js-sdk['"]|https:\/\/api\.(?:retellai|resend|getjobber)\.com|client\.llm\.(?:retrieve|update)|function createEquipmentExtractor|fetch\(config\.apiBase|client\.messages\.create\(|client\.events\.insert\(|spreadsheets\.values\.(?:append|update)\(|new OpenAI\b/;

const DEMO_COMMAND_CENTER_ENTRY_POINTS = [
  '/command-center/operations/appointments/:appointmentId/actions',
  '/command-center/appointments/:appointmentId/mutation-previews',
  '/command-center/appointments/:appointmentId/mutation-approvals',
  '/command-center/simulations/leads',
  '/command-center/reset',
  '/command-center/estimates/:estimateId/equipment-readiness-plans',
  '/command-center/estimates/:estimateId/equipment-readiness-preview',
  '/command-center/estimates/:estimateId/commercial-terms',
  '/command-center/estimates/:estimateId/commercial-approvals',
  '/command-center/estimates/:estimateId/commercial-preview',
  '/command-center/tax-preparation',
  '/command-center/estimates/:estimateId/pricing-policies',
  '/command-center/estimates/:estimateId/pricing-policy-preview',
  '/command-center/estimates/:estimateId/pricing-plans',
  '/command-center/estimates/:estimateId/pricing-plan-preview',
  '/command-center/estimates/:estimateId/travel-plans',
  '/command-center/estimates/:estimateId/travel-plan-preview',
  '/command-center/estimates/:estimateId/equipment-cost-plans',
  '/command-center/estimates/:estimateId/equipment-cost-preview',
  '/command-center/estimates/:estimateId/equipment-plans',
  '/command-center/estimates/:estimateId/equipment-plan-preview',
  '/command-center/estimates/:estimateId/labor-plans',
  '/command-center/estimates/:estimateId/labor-plan-preview',
  '/command-center/estimates/:estimateId/material-plans',
  '/command-center/estimates/:estimateId/material-plan-preview',
  '/command-center/estimates/:estimateId/material-adoptions',
  '/command-center/estimates/:estimateId/cost-adoptions',
  '/command-center/estimates/:estimateId/cost-adoption-preview',
  '/command-center/estimates/:estimateId/material-adoption-preview',
  '/command-center/estimates/:estimateId/decisions',
  '/command-center/polaris/messages-v2',
  '/command-center/estimates/:estimateId/proposal-adoption-preview',
  '/command-center/estimates/:estimateId/proposal-adoptions',
  '/command-center/estimates/:estimateId/proposal-preview',
  '/command-center/estimates/:estimateId/capella-scenarios',
  '/command-center/estimates/:estimateId/customer-estimate-versions',
  '/command-center/estimates/:estimateId/customer-estimate-links',
  '/command-center/estimates/:estimateId/customer-estimate-links/:linkId/revoke',
];

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function inventory() {
  return JSON.parse(read(INVENTORY_PATH));
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function slash(value) {
  return value.split(path.sep).join('/');
}

function sourcePaths(value) {
  return new Set(value.surfaces.flatMap(surface => surface.sourceRefs.map(reference => reference.path)));
}

function matchingPaths(files, pattern) {
  return files.filter(file => pattern.test(fs.readFileSync(file, 'utf8')))
    .map(file => slash(path.relative(ROOT, file))).sort();
}

function relativeDependencies(file) {
  const source = fs.readFileSync(file, 'utf8');
  const specifiers = [
    ...source.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g),
    ...source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g),
    ...source.matchAll(/\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g),
  ].map(match => match[1]);
  return new Set(specifiers.map(specifier => {
    const stem = path.resolve(path.dirname(file), specifier);
    const candidates = [stem, `${stem}.js`, `${stem}.mjs`, path.join(stem, 'index.js'), path.join(stem, 'index.mjs')];
    const resolved = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    return resolved ? slash(path.relative(ROOT, resolved)) : null;
  }).filter(Boolean));
}

function validate(value) {
  if (value.contractVersion !== 'mission28.part1b.surface-inventory.v1') throw new Error('version');
  if (value.authority.baselineCommit !== BASE || value.authority.baselineTree !== BASE_TREE) throw new Error('base');
  if (JSON.stringify(value.dispositions) !== JSON.stringify(DISPOSITIONS)) throw new Error('dispositions');
  if (JSON.stringify(value.requiredFacets) !== JSON.stringify(FACETS)) throw new Error('facets');
  if (!Array.isArray(value.surfaces) || value.surfaces.length !== 49) throw new Error('surface count');
  const ids = value.surfaces.map(surface => surface.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate surface');
  for (const surface of value.surfaces) {
    if (!/^[a-z0-9.-]+$/.test(surface.id) || !DISPOSITIONS.includes(surface.disposition) ||
        typeof surface.owner !== 'string' || !surface.owner ||
        typeof surface.effectBoundary !== 'string' || surface.effectBoundary.length < 40 ||
        !Array.isArray(surface.facets) || !surface.facets.length ||
        surface.facets.some(facet => !FACETS.includes(facet)) ||
        !Array.isArray(surface.sourceRefs) || !surface.sourceRefs.length) throw new Error(`surface ${surface.id}`);
  }
  for (const facet of FACETS) {
    if (!value.surfaces.some(surface => surface.facets.includes(facet))) throw new Error(`missing facet ${facet}`);
  }
  for (const disposition of DISPOSITIONS) {
    if (!value.surfaces.some(surface => surface.disposition === disposition)) throw new Error(`missing disposition ${disposition}`);
  }
  const dispositionCounts = Object.fromEntries(DISPOSITIONS.map(disposition => [disposition,
    value.surfaces.filter(surface => surface.disposition === disposition).length]));
  if (JSON.stringify(dispositionCounts) !== JSON.stringify({
    mission28_owned_reusable_after_later_authority: 2,
    upstream_or_subscription_owned_excluded: 19,
    simulated_or_demo_only: 8,
    legacy_unsupported_or_quarantined: 14,
    manual_handoff: 3,
    ambiguous_fail_closed: 3,
  })) throw new Error('disposition counts');
  return value;
}

describe('Mission 28 Part 1B automation-surface inventory', () => {
  test('is an exact bounded candidate with six dispositions, forty-nine unique surfaces and all required facets', () => {
    const value = validate(inventory());
    expect(value.authority.state).toBe('implementation_candidate');
    expect(value.authority.part1A).toEqual({
      sourceHead: 'c42d1a9f72dcb6bbdd480e804988ddc3ec43cc09',
      pullRequest: 549,
      mergedMain: BASE,
      deployment: 'd3010671-da95-4247-807f-f2089b90df74',
      deploymentState: 'SUCCESS_RUNNING',
      imageSha256: '12b0bfeb266c4849b127102ad98a2f8b6ad06080898462c41ee63c3a5b699b26',
      auditReportSha256: '1C3AA77E9B1E31A4FE4A8167FC2072A5818EDC52D19B5BCB1356352FEADDBDE1',
    });
    expect(Object.fromEntries(DISPOSITIONS.map(disposition => [disposition,
      value.surfaces.filter(surface => surface.disposition === disposition).length]))).toEqual({
      mission28_owned_reusable_after_later_authority: 2,
      upstream_or_subscription_owned_excluded: 19,
      simulated_or_demo_only: 8,
      legacy_unsupported_or_quarantined: 14,
      manual_handoff: 3,
      ambiguous_fail_closed: 3,
    });
  });

  test('binds every record to existing exact source anchors', () => {
    const value = validate(inventory());
    for (const record of [...value.surfaces, ...value.negativeFindings]) {
      for (const reference of record.sourceRefs) {
        const document = read(reference.path);
        expect(reference.anchors.length).toBeGreaterThan(0);
        for (const anchor of reference.anchors) {
          expect(document).toContain(anchor);
        }
      }
    }
  });

  test('covers every current server worker class without treating timers as cron authority', () => {
    const discovered = walk(path.join(ROOT, 'src'))
      .filter(file => file.endsWith('.js') && /^class [A-Za-z0-9_]*Worker|^class .*Worker extends/m.test(fs.readFileSync(file, 'utf8')))
      .map(file => slash(path.relative(ROOT, file))).sort();
    expect(discovered).toEqual(WORKER_PATHS);
    const covered = sourcePaths(inventory());
    for (const worker of WORKER_PATHS) expect(covered.has(worker)).toBe(true);
    const source = walk(path.join(ROOT, 'src')).filter(file => file.endsWith('.js'))
      .map(file => fs.readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/require\(['"]node-cron['"]\)|from ['"]node-cron['"]|cron\.schedule\s*\(/);
  });

  test('covers the current business-event, provider, webhook, notification and handoff source set', () => {
    const covered = sourcePaths(inventory());
    for (const candidate of [...BUSINESS_EVENT_PATHS, ...PROVIDER_IMPLEMENTATION_PATHS,
      ...PROVIDER_IMPORT_CONSUMER_PATHS,
      'src/routes/retellWebhookBoundary.js', 'src/customerFinancial/paymentProviderEventReceipt.js',
      'src/routes/api.js', 'src/routes/voice.js', 'src/routes/connectedCall.js',
      'src/forecasting/retellCallScanReader.js', 'src/routes/forecastDemandSources.js',
      'src/customerFinancial/collectionHandoffReadiness.js', 'src/customerFinancial/collectionReview.js',
      'public/js/customer-detail.js', 'public/js/calendar-engine.js', 'public/js/homepage-demo.js',
      'public/contact.html']) {
      expect(covered.has(candidate)).toBe(true);
    }
    const allBrowser = walk(path.join(ROOT, 'public')).filter(file => /\.(?:js|html)$/.test(file))
      .map(file => fs.readFileSync(file, 'utf8')).join('\n');
    expect(allBrowser).not.toContain('navigator.share');
  });

  test('discovers every high-signal external adapter, native handoff, browser bus and durable queue source', () => {
    const covered = sourcePaths(inventory());
    const sourceFiles = walk(path.join(ROOT, 'src')).filter(file => file.endsWith('.js'));
    const browserFiles = walk(path.join(ROOT, 'public')).filter(file => /\.(?:js|html)$/.test(file) &&
      !slash(file).includes('/vendor/'));
    const discoveries = [
      matchingPaths([...sourceFiles, ...browserFiles],
        /https:\/\/api\.(?:retellai|resend)\.com|nodemailer\.createTransport|messages\.create\(|events\.insert\(|spreadsheets\.values\.append\(|new OpenAI\b|createEquipmentExtractor\b|createProductionKnowledgeTransports\b|createJobberIntegrationRouter\b/),
      matchingPaths(browserFiles, /(?:tel:|mailto:)|calendar\.ics|navigator\.share\b/),
      matchingPaths(browserFiles, /window\.EventBus\s*=|\bbus\.(?:emit|on)\(/),
      matchingPaths(sourceFiles,
        /canonical_operations|account_email_outbox|support_case_email_outbox|canonical_knowledge_sync_outbox/),
    ];
    for (const discovered of discoveries.flat()) expect(covered.has(discovered)).toBe(true);
  });

  test('discovers active browser event producers, listeners, local-store writers and simulator consumers', () => {
    const covered = sourcePaths(inventory());
    const browserFiles = walk(path.join(ROOT, 'public'))
      .filter(file => /\.(?:js|html)$/.test(file) && !slash(file).includes('/vendor/'));
    const browserScripts = browserFiles.filter(file => file.endsWith('.js'));
    const producers = matchingPaths(browserScripts,
      /(?:window|global)\.EventBus\.emit\(|\bbus\.emit\(|window\.AppStore\.[A-Za-z]+\(/);
    expect(producers).toEqual(BROWSER_EVENT_PRODUCER_PATHS);
    const listeners = matchingPaths(browserFiles,
      /EventBus\.on\(|\bbus\.on\(|addEventListener\(['"]canonical:loaded['"]/);
    expect(listeners).toEqual(BROWSER_EVENT_LISTENER_PATHS);
    const consumers = matchingPaths(browserFiles.filter(file => file.endsWith('.html')),
      /<script src=["']\/js\/simulator\.js["']><\/script>/);
    expect(consumers).toEqual(SIMULATOR_CONSUMER_PATHS);
    for (const candidate of [...producers, ...listeners, ...consumers]) expect(covered.has(candidate)).toBe(true);

    const simulator = inventory().surfaces.find(surface =>
      surface.id === 'demo.legacy-browser-call-simulator');
    expect(simulator.disposition).toBe('upstream_or_subscription_owned_excluded');
    expect(simulator.entryPoints).toEqual([
      'window.ccSimulateLead()', 'window.genCall()', 'window.AppStore.addLead(call)',
      "window.EventBus.emit('call:generated', call)", 'POST /api/v1/simulations/leads',
    ]);
    expect(simulator.effectBoundary).toContain('accepted synthetic tenant record');
    const localBus = inventory().surfaces.find(surface => surface.id === 'event.browser-local-store-bus');
    expect(localBus.sourceRefs.map(reference => reference.path))
      .toContain('public/js/canonical-intelligence.js');
  });

  test('discovers the complete paid synthetic-write pipeline and its tenant-record boundary', () => {
    const covered = sourcePaths(inventory());
    const files = [
      ...walk(path.join(ROOT, 'src')).filter(file => file.endsWith('.js')),
      ...walk(path.join(ROOT, 'public')).filter(file => /\.(?:js|html)$/.test(file) &&
        !slash(file).includes('/vendor/')),
    ];
    const discovered = matchingPaths(files,
      /NorthStarAccountSession\.fetch\('\/api\/v1\/simulations\/leads'|apiFetch\('\/api\/v1\/simulations\/leads'|router\.post\('\/simulations\/leads'|const simulationsRoutes = require\('\.\/routes\/simulations'\)|function ingestSimulation\(pool, source, options\)|function withDeterministicSeed\(seed, work\)/);
    expect(discovered).toEqual(PAID_SIMULATION_WRITE_PATHS);
    for (const candidate of PAID_SIMULATION_WRITE_PATHS) expect(covered.has(candidate)).toBe(true);
    const graphDependencies = relativeDependencies(path.join(ROOT, 'src/services/canonicalGraphService.js'));
    expect(graphDependencies).toContain('src/persistence/v2/repository.js');
    expect(covered.has('src/persistence/v2/repository.js')).toBe(true);
    const surface = inventory().surfaces.find(item => item.id === 'demo.legacy-browser-call-simulator');
    expect(surface.sourceRefs.map(reference => reference.path))
      .toEqual(expect.arrayContaining([...PAID_SIMULATION_WRITE_PATHS,
        'src/persistence/v2/repository.js']));
  });

  test('discovers legacy workflow/reminder engines and current notification preferences', () => {
    const covered = sourcePaths(inventory());
    const sourceFiles = walk(path.join(ROOT, 'src')).filter(file => file.endsWith('.js'));
    const workflows = matchingPaths(sourceFiles,
      /automated workflows across|Get follow-up recommendations for a customer/);
    const preferences = matchingPaths(sourceFiles,
      /email_new_lead|email_call_summary|email_appointment|sms_new_lead|sms_urgent|notification_phone/);
    expect(workflows).toEqual(LEGACY_WORKFLOW_PATHS);
    expect(preferences).toEqual(NOTIFICATION_PREFERENCE_PATHS);
    for (const candidate of [...workflows, ...preferences, 'src/polaris/analytics-engine.js',
      'src/polaris/store.js']) {
      expect(covered.has(candidate)).toBe(true);
    }
    expect(relativeDependencies(path.join(ROOT, 'src/polaris/analytics-engine.js')))
      .toContain('src/polaris/workflow-engine.js');
    const byId = Object.fromEntries(inventory().surfaces.map(surface => [surface.id, surface]));
    expect(byId['workflow.legacy-polaris-reminders-followups'].disposition)
      .toBe('legacy_unsupported_or_quarantined');
    expect(byId['preferences.account-notification-destinations'].disposition)
      .toBe('upstream_or_subscription_owned_excluded');
    expect(byId['preferences.account-notification-destinations'].effectBoundary)
      .toContain('do not establish recipient consent');
  });

  test('discovers and quarantines every unmounted legacy voice automation engine', () => {
    const voiceFiles = walk(path.join(ROOT, 'src', 'voice')).filter(file => file.endsWith('.js'));
    const discovered = matchingPaths(voiceFiles,
      /Provides Retell-compatible function definitions and handlers|Triggered when call_ended event fires|Six escalation triggers/);
    expect(discovered).toEqual(LEGACY_VOICE_AUTOMATION_PATHS);
    const byId = Object.fromEntries(inventory().surfaces.map(surface => [surface.id, surface]));
    for (const id of ['voice.legacy-retell-tool-registry', 'voice.legacy-call-completion-pipeline',
      'voice.legacy-human-handoff']) {
      expect(byId[id].disposition).toBe('legacy_unsupported_or_quarantined');
    }
    expect(byId['voice.legacy-retell-tool-registry'].effectBoundary)
      .toContain('No mounted tenant authority');
    expect(byId['voice.legacy-call-completion-pipeline'].effectBoundary)
      .toContain('not a subscribed canonical event worker');
    expect(byId['voice.legacy-human-handoff'].effectBoundary)
      .toContain('do not contact a human');
    const covered = sourcePaths(inventory());
    for (const candidate of discovered) expect(covered.has(candidate)).toBe(true);
  });

  test('discovers the complete mounted Mission 27 provider lifecycle and keeps every effect unavailable', () => {
    const discovered = walk(path.join(ROOT, 'src')).map(file => slash(path.relative(ROOT, file)))
      .filter(file => file === 'src/server.js' ||
        /^src\/middleware\/providerLifecycle(?:Health|Retention|Recovery|Acceptance)Boundary\.js$/.test(file) ||
        /^src\/routes\/customerFinancial(?:PaymentProvider|Provider(?:Connection|Lifecycle|Retention|Recovery|Acceptance|EventReceipt|EventNormalization))\.js$/.test(file) ||
        /^src\/customerFinancial\/(?:paymentProvider(?:Boundary|Connection|EventReceipt|EventNormalization)(?:Repository)?|providerLifecycle(?:Health|Retention|Recovery|Acceptance)(?:HttpBoundary|Repository)?)\.js$/.test(file))
      .sort();
    expect(discovered).toEqual(MISSION27_PAYMENT_PROVIDER_LIFECYCLE_PATHS);
    const surface = inventory().surfaces.find(item => item.id === 'provider.mission27-payment-boundary');
    expect(surface.sourceRefs.map(reference => reference.path).sort())
      .toEqual(MISSION27_PAYMENT_PROVIDER_LIFECYCLE_PATHS);
    const server = read('src/server.js');
    for (const route of [
      '/api/v1/customer-financial/payment-provider/connection',
      '/api/v1/customer-financial/payment-provider/lifecycle-health',
      '/api/v1/customer-financial/payment-provider/lifecycle-retention',
      '/api/v1/customer-financial/payment-provider/lifecycle-recovery',
      '/api/v1/customer-financial/payment-provider/lifecycle-acceptance',
      '/api/v1/customer-financial/payment-provider/event-receipt',
      '/api/v1/customer-financial/payment-provider/event-normalization',
      '/api/v1/customer-financial/payment-provider',
    ]) expect(server).toContain(`'${route}'`);
    const recovery = read('src/customerFinancial/providerLifecycleRecovery.js');
    for (const denial of ['enqueueAuthorized: false', 'dequeueAuthorized: false',
      'retryAuthorized: false', 'failoverAuthorized: false', 'alertingAuthorized: false',
      'queueMutationAuthorized: false', 'alertMutationAuthorized: false']) {
      expect(recovery).toContain(denial);
    }
    expect(surface.effectBoundary).toContain('frozen provider-disabled');
    expect(surface.effectBoundary).toContain('not adapters or reusable effect authority');
  });

  test('binds signed Retell ingress to its directly imported durable replay authority', () => {
    const sourceFiles = walk(path.join(ROOT, 'src')).filter(file => file.endsWith('.js'));
    const replayConsumers = matchingPaths(sourceFiles,
      /require\(['"]\.\.\/retell\/webhookReplayAuthority['"]\)/);
    expect(replayConsumers).toEqual(['src/voice/webhook.js']);

    const route = read('src/routes/retellWebhookBoundary.js');
    expect(route).toContain("require('../voice/webhook')");
    expect(route).toContain("router.post('/api/retell/webhook'");
    expect(route).toContain("router.post('/api/v1/voice/webhook'");

    const webhook = read('src/voice/webhook.js');
    expect(webhook).toContain("require('../retell/webhookReplayAuthority')");
    for (const operation of ['claimWebhookDelivery', 'releaseWebhookDelivery',
      'finalizeWebhookDelivery']) expect(webhook).toContain(`replayAuthority.${operation}`);

    const replay = read('src/retell/webhookReplayAuthority.js');
    for (const invariant of ['const CLAIM_LEASE_MS = 60 * 1000',
      'const REPLAY_RETENTION_MS = 24 * 60 * 60 * 1000',
      'const MAX_REPLAY_ENTRIES = 10000', "return { kind: 'replay' }",
      "return { kind: 'saturated' }"]) expect(replay).toContain(invariant);

    const surface = inventory().surfaces.find(item => item.id === 'webhook.retell-signed-ingress');
    expect(surface.sourceRefs.map(reference => reference.path)).toEqual(RETELL_WEBHOOK_REPLAY_CHAIN_PATHS);
    expect(surface.effectBoundary).toContain('durable PostgreSQL replay claim lifecycle');
    expect(surface.effectBoundary).toContain('do not grant Mission 28 retry');
  });

  test('discovers every outbound provider implementation and its active direct consumers', () => {
    const covered = sourcePaths(inventory());
    const scripts = [
      ...walk(path.join(ROOT, 'src')).filter(file => /\.(?:js|mjs)$/.test(file)),
      ...walk(path.join(ROOT, 'public')).filter(file => /\.(?:js|mjs)$/.test(file) &&
        !slash(file).includes('/vendor/')),
    ];
    const implementations = matchingPaths(scripts, PROVIDER_IMPLEMENTATION_SIGNAL);
    expect(implementations).toEqual(PROVIDER_IMPLEMENTATION_PATHS);
    const implementationSet = new Set(implementations);
    const consumers = scripts.filter(file => [...relativeDependencies(file)]
      .some(dependency => implementationSet.has(dependency)))
      .map(file => slash(path.relative(ROOT, file))).sort();
    expect(consumers).toEqual(PROVIDER_IMPORT_CONSUMER_PATHS);
    for (const candidate of [...implementations, ...consumers]) expect(covered.has(candidate)).toBe(true);

    // The browser provider is bundled through package.json and loaded by output path,
    // so it deliberately has no source-relative import edge.
    expect(read('package.json')).toContain('esbuild src/browser/retellWebEntry.mjs');
    expect(read('package.json')).toContain('--outfile=public/js/vendor/retell-web-client.mjs');
    expect(read('public/js/homepage-demo.js')).toContain("var SDK_URL = '/js/vendor/retell-web-client.mjs'");
    for (const candidate of ['package.json', 'src/browser/retellWebEntry.mjs', 'public/js/homepage-demo.js']) {
      expect(covered.has(candidate)).toBe(true);
    }
  });

  test('discovers the complete dependency-injected OpenAI Polaris provider consumer chain', () => {
    const covered = sourcePaths(inventory());
    const sourceFiles = walk(path.join(ROOT, 'src')).filter(file => file.endsWith('.js'));
    const discovered = matchingPaths(sourceFiles,
      /createProductionOpenAIRuntime|createProviderUsageLedger|connectedCallGenerate|demoGroundedRuntime|require\(['"]\.\.\/polaris\/demoGrounded['"]\)\.createHandler|async function executeProvider\(runtime|function createProductionCallGenerate/);
    expect(discovered).toEqual(OPENAI_POLARIS_PROVIDER_CHAIN_PATHS);
    for (const candidate of discovered) expect(covered.has(candidate)).toBe(true);
    const surface = inventory().surfaces.find(item => item.id === 'provider.openai-polaris-runtime');
    expect(surface.sourceRefs.map(reference => reference.path).sort())
      .toEqual(OPENAI_POLARIS_PROVIDER_CHAIN_PATHS);
    expect(surface.effectBoundary).toContain('never self-authorizes an automation decision or external effect');
  });

  test('discovers the complete paid and demo secure-estimate link handoff and public response chain', () => {
    const covered = sourcePaths(inventory());
    const files = [
      ...walk(path.join(ROOT, 'src')).filter(file => file.endsWith('.js')),
      ...walk(path.join(ROOT, 'public')).filter(file => /\.(?:js|html)$/.test(file) &&
        !slash(file).includes('/vendor/')),
    ];
    const discovered = matchingPaths(files,
      /function deliveryRoute\(review\)|customerEstimateDelivery(?:Contract|Repository)|CUSTOMER_ESTIMATE_LINK_SECRET|function customerEstimateDeliveryBodyBoundary|customer-estimates\/:token|createCustomerEstimateDeliveryRouter|customer-estimate-public\.js|fetch\('\/api\/public\/customer-estimates\//);
    expect(discovered).toEqual(CUSTOMER_ESTIMATE_HANDOFF_PATHS);
    for (const candidate of discovered) expect(covered.has(candidate)).toBe(true);
    const surface = inventory().surfaces.find(item => item.id === 'handoff.customer-estimate-secure-link');
    expect(surface.sourceRefs.map(reference => reference.path).sort())
      .toEqual(CUSTOMER_ESTIMATE_HANDOFF_PATHS);
    expect(surface.entryPoints).toEqual(expect.arrayContaining([
      '/api/v1/canonical/estimates/:estimateId/customer-estimate-links',
      '/api/demo/command-center/estimates/:estimateId/customer-estimate-links',
      '/estimate/:token',
      '/api/public/customer-estimates/:token/accept',
      '/api/public/customer-estimates/:token/questions',
    ]));
    expect(surface.effectBoundary).toContain('None of those actions sends the link');
  });

  test('keeps Mission 21, 24, 26, canonical voice and homepage provider boundaries distinct', () => {
    const byId = Object.fromEntries(inventory().surfaces.map(surface => [surface.id, surface]));
    expect(byId['worker.tax-research'].sourceRefs.map(reference => reference.path))
      .toContain('src/estimating/taxSourceTransport.js');
    expect(byId['provider.retell-knowledge-transport'].sourceRefs.map(reference => reference.path))
      .toContain('src/knowledge/retellProjectionTransport.js');
    expect(byId['provider.mission26-retell-call-reconciliation'].sourceRefs.map(reference => reference.path))
      .toEqual(['src/forecasting/retellCallReconciliation.js',
        'src/forecasting/retellCallScanReader.js', 'src/routes/forecastDemandSources.js']);
    expect(byId['provider.retell-call-sms-client'].sourceRefs.map(reference => reference.path))
      .toContain('src/services/canonicalVoiceSessionCreation.js');
    expect(byId['demo.homepage-web-call-and-polaris'].sourceRefs.map(reference => reference.path))
      .toEqual(expect.arrayContaining([
        'src/browser/retellWebEntry.mjs', 'public/js/homepage-demo.js',
      ]));
    expect(new Set([
      byId['worker.tax-research'].owner,
      byId['provider.retell-knowledge-transport'].owner,
      byId['provider.mission26-retell-call-reconciliation'].owner,
      byId['provider.retell-call-sms-client'].owner,
      byId['demo.homepage-web-call-and-polaris'].owner,
    ]).size).toBe(5);
  });

  test('enumerates every command-center demo mutation path and keeps all demo surfaces isolated', () => {
    const value = inventory();
    const family = value.surfaces.find(surface => surface.id === 'demo.command-center-action-family');
    expect(family.entryPoints).toEqual(DEMO_COMMAND_CENTER_ENTRY_POINTS);
    const demoSource = read('src/routes/demo.js');
    const exactLiterals = DEMO_COMMAND_CENTER_ENTRY_POINTS.filter(route =>
      !route.endsWith('/mutation-previews') && !route.endsWith('/mutation-approvals') &&
      !route.endsWith('/commercial-terms') && !route.endsWith('/commercial-approvals') &&
      route !== '/command-center/estimates/:estimateId/material-adoptions' &&
      route !== '/command-center/estimates/:estimateId/cost-adoptions');
    for (const route of exactLiterals) expect(demoSource).toContain(`'${route}'`);
    for (const marker of [
      "['mutation-previews','schedule_preview']", "['mutation-approvals','schedule_approve']",
      "['commercial-terms','commercial_terms']", "['commercial-approvals','commercial_ok']",
      "'/command-center/estimates/:estimateId/material-adoptions'",
      "'/command-center/estimates/:estimateId/cost-adoptions'",
    ]) expect(demoSource).toContain(marker);
    expect(value.surfaces.filter(surface => surface.facets.includes('demo_action') &&
      surface.id !== 'demo.legacy-browser-call-simulator')
      .every(surface => ['simulated_or_demo_only', 'legacy_unsupported_or_quarantined'].includes(surface.disposition))).toBe(true);
    expect(value.surfaces.find(surface => surface.id === 'demo.legacy-browser-call-simulator').disposition)
      .toBe('upstream_or_subscription_owned_excluded');
  });

  test('quarantines effect-capable legacy paths and preserves the fact-decision-effect-evidence boundary', () => {
    const byId = Object.fromEntries(inventory().surfaces.map(surface => [surface.id, surface]));
    for (const id of [
      'notification.legacy-lead-email', 'notification.legacy-lead-sms',
      'notification.legacy-simulated-lead-fanout', 'provider.google-sheets-lead-append',
      'provider.jobber-oauth-and-lead-push', 'browser.legacy-communications-provider-registry',
      'browser.legacy-retell-provider', 'workflow.legacy-polaris-reminders-followups',
      'demo.retired-call-mutations', 'voice.legacy-retell-tool-registry',
      'voice.legacy-call-completion-pipeline', 'voice.legacy-human-handoff',
    ]) expect(byId[id].disposition).toBe('legacy_unsupported_or_quarantined');
    expect(byId['demo.legacy-browser-call-simulator'].disposition)
      .toBe('upstream_or_subscription_owned_excluded');
    expect(byId['collection.mission27-reviewed-handoff-labels'].effectBoundary)
      .toContain('do not authorize reminders, retry, charges, fees, legal escalation, or external collection');
    expect(byId['handoff.customer-phone-and-email'].effectBoundary)
      .toContain('no sent, delivered, replied, or successful evidence');
  });

  test('fails deletions, renames, unknown dispositions, missing anchors and optimistic reclassification', () => {
    const original = inventory();
    const mutations = [
      { ...original, surfaces: original.surfaces.slice(1) },
      { ...original, dispositions: original.dispositions.slice().reverse() },
      { ...original, requiredFacets: original.requiredFacets.filter(facet => facet !== 'webhook') },
      { ...original, surfaces: original.surfaces.map((surface, index) => index ? surface : { ...surface, id: 'Renamed' }) },
      { ...original, surfaces: original.surfaces.map(surface => surface.id === 'notification.legacy-simulated-lead-fanout'
        ? { ...surface, disposition: 'mission28_owned_reusable_after_later_authority' } : surface) },
    ];
    for (const mutation of mutations) expect(() => validate(mutation)).toThrow();
    const missingAnchor = structuredClone(original);
    missingAnchor.surfaces[0].sourceRefs[0].anchors[0] = 'invented authority';
    expect(read(missingAnchor.surfaces[0].sourceRefs[0].path)).not.toContain('invented authority');
  });

  test('records Part 1A released, Part 1B as the sole candidate and every later slice as planned', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    expect(roadmap).toContain('Part 1A released; Part 1B implementation candidate only.');
    expect(roadmap).toContain('Parts 1C–14G remain planned and unimplemented.');
    const rows = [...ledger.matchAll(/^\| (\d{2}) \| (\d{1,2}[A-G]) \| (.+) \| (.+) \| (.+) \|$/gm)];
    expect(rows).toHaveLength(66);
    expect(rows[0][4]).toBe('**Released**');
    expect(rows[0][5]).toContain('PR #549');
    expect(rows[1][4]).toBe('**Implementation candidate**');
    expect(rows[1][5]).toContain('independent audit, PR, merge, deployment and release unavailable');
    expect(rows.slice(2).every(row => row[4] === 'Planned / unimplemented' && row[5] === 'None')).toBe(true);
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1);
  });

  test('does not activate the inventory from production source or add a migration', () => {
    const productionSource = walk(path.join(ROOT, 'src')).filter(file => file.endsWith('.js'))
      .map(file => fs.readFileSync(file, 'utf8')).join('\n');
    expect(productionSource).not.toContain('MISSION_28_PART1B_SURFACE_INVENTORY');
    expect(productionSource).not.toContain('mission28.part1b.surface-inventory.v1');
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => name.endsWith('.sql'))
      .sort((left, right) => Number(left.split('_')[0]) - Number(right.split('_')[0]));
    expect(migrations).toHaveLength(268);
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });

  test('keeps Part 1C risk and Part 1D launch authority explicitly unimplemented', () => {
    const contract = read(CONTRACT_PATH);
    expect(contract).toContain('Part 1C risk classification and Part 1D launch support remain entirely unimplemented.');
    expect(contract).toContain('No provider account, credential, sender, template approval, callback, sandbox');
    expect(contract).toContain('Part 1B performs no runtime mutation.');
    expect(contract).toContain('writer-produced evidence. It is not independently accepted');
  });
});
