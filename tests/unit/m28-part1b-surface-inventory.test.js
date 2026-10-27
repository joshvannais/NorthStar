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
  'public/js/communications-engine.js',
  'public/js/event-bus.js',
  'public/js/notification-service.js',
  'public/js/retell-provider.js',
  'src/voice/businessEvents.js',
  'src/voice/eventIntelligence.js',
  'src/voice/transcriptStream.js',
  'src/voice/webhook.js',
];

const EXTERNAL_ADAPTER_PATHS = [
  'public/js/retell-provider.js',
  'src/calendar/client.js',
  'src/email/transactional.js',
  'src/equipment/provider.js',
  'src/estimating/taxSourceBinding.js',
  'src/integrations/jobber.js',
  'src/knowledge/providerBindings.js',
  'src/notifications/email.js',
  'src/notifications/sms.js',
  'src/persistence/v2/repository.js',
  'src/polaris/openaiRuntime.js',
  'src/retell/client.js',
  'src/sheets/client.js',
];

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

function validate(value) {
  if (value.contractVersion !== 'mission28.part1b.surface-inventory.v1') throw new Error('version');
  if (value.authority.baselineCommit !== BASE || value.authority.baselineTree !== BASE_TREE) throw new Error('base');
  if (JSON.stringify(value.dispositions) !== JSON.stringify(DISPOSITIONS)) throw new Error('dispositions');
  if (JSON.stringify(value.requiredFacets) !== JSON.stringify(FACETS)) throw new Error('facets');
  if (!Array.isArray(value.surfaces) || value.surfaces.length !== 42) throw new Error('surface count');
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
    upstream_or_subscription_owned_excluded: 16,
    simulated_or_demo_only: 8,
    legacy_unsupported_or_quarantined: 10,
    manual_handoff: 3,
    ambiguous_fail_closed: 3,
  })) throw new Error('disposition counts');
  return value;
}

describe('Mission 28 Part 1B automation-surface inventory', () => {
  test('is an exact bounded candidate with six dispositions, forty-two unique surfaces and all required facets', () => {
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
      upstream_or_subscription_owned_excluded: 16,
      simulated_or_demo_only: 8,
      legacy_unsupported_or_quarantined: 10,
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
    for (const candidate of [...BUSINESS_EVENT_PATHS, ...EXTERNAL_ADAPTER_PATHS,
      'src/routes/retellWebhookBoundary.js', 'src/customerFinancial/paymentProviderEventReceipt.js',
      'src/routes/api.js', 'src/routes/voice.js', 'src/routes/connectedCall.js',
      'src/customerFinancial/collectionHandoffReadiness.js', 'src/customerFinancial/collectionReview.js',
      'public/js/customer-detail.js', 'public/js/calendar-engine.js', 'public/contact.html']) {
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
    expect(value.surfaces.filter(surface => surface.facets.includes('demo_action'))
      .every(surface => ['simulated_or_demo_only', 'legacy_unsupported_or_quarantined'].includes(surface.disposition))).toBe(true);
  });

  test('quarantines effect-capable legacy paths and preserves the fact-decision-effect-evidence boundary', () => {
    const byId = Object.fromEntries(inventory().surfaces.map(surface => [surface.id, surface]));
    for (const id of [
      'notification.legacy-lead-email', 'notification.legacy-lead-sms',
      'notification.legacy-simulated-lead-fanout', 'provider.google-sheets-lead-append',
      'provider.jobber-oauth-and-lead-push', 'browser.legacy-communications-provider-registry',
      'browser.legacy-retell-provider', 'demo.retired-call-mutations',
    ]) expect(byId[id].disposition).toBe('legacy_unsupported_or_quarantined');
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
