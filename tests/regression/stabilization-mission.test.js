'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const demoScope = require('../../src/services/demoRecordScope');
const canonicalPolaris = require('../../src/services/canonicalPolaris');
const CATALOG = require('../../src/routes/simulation/service-catalog');
const pipeline = require('../../src/routes/simulation/pipeline');
const businessProfile = require('../../data/business-profile.json');

function buildService(serviceKey, scope, missing, options) {
  const definition = CATALOG[serviceKey];
  const pricing = definition.pricing.calculate(scope);
  const evidence = Object.keys(scope).reduce(function (result, field) {
    result[field] = 'Transcript supports ' + field;
    return result;
  }, {});
  return canonicalPolaris.build(Object.assign({
    serviceKey: serviceKey,
    classification: { service: definition.displayName, confidence: 'high', alternatives: [] },
    scope: scope,
    evidence: evidence,
    missingInformation: missing || [],
    pricing: pricing,
    confidence: { score: 90, explanation: 'Required scope is supported.' },
    recommendedAction: { action: 'Review and schedule', priority: 'medium' },
    businessProfile: businessProfile,
  }, options || {}));
}

function expectPriceReconciliation(intelligence) {
  const componentTotal = intelligence.pricingBreakdown.reduce(function (sum, item) {
    return sum + item.amount;
  }, 0);
  expect(componentTotal).toBeCloseTo(intelligence.customerFacingPrice, 2);
  const internalComponents = intelligence.pricingBreakdown.filter(function (item) {
    return item.category === 'internalCost';
  }).reduce(function (sum, item) { return sum + item.amount; }, 0);
  expect(internalComponents).toBeCloseTo(intelligence.internalCost, 2);
}

describe('NorthStar stabilization mission', function () {
  describe('durable demo-session ownership', function () {
    function runDemoSession(navigationType, storage) {
      const code = fs.readFileSync(path.join(__dirname, '../../public/js/demo-session.js'), 'utf8');
      const window = {
        performance: {
          getEntriesByType: function (type) {
            return type === 'navigation' ? [{ type: navigationType }] : [];
          },
        },
        sessionStorage: {
          getItem: function (key) { return storage.has(key) ? storage.get(key) : null; },
          setItem: function (key, value) { storage.set(key, value); },
        },
      };
      vm.runInNewContext(code, { window: window, Date: Date, Math: Math, encodeURIComponent: encodeURIComponent });
      return window.NorthStarDemoSession;
    }

    function graph(sessionId, suffix) {
      const metadata = demoScope.createMetadata(sessionId);
      const customerId = 'cust-' + suffix;
      return [
        { id: customerId, metadata: metadata },
        { id: 'opp-' + suffix, customerId: customerId, metadata: metadata },
        { id: 'est-' + suffix, customerId: customerId, metadata: metadata },
        { id: 'comm-' + suffix, customerId: customerId, type: 'call', metadata: metadata },
      ];
    }

    test('fresh, navigation, second simulation, and reload preserve one canonical graph per session', function () {
      const real = [{ id: 'real-customer' }];
      const sessionOne = graph('session-one', 'one');
      const sessionTwo = graph('session-one', 'two');
      const anotherSession = graph('session-two', 'three');
      const records = real.concat(sessionOne, sessionTwo, anotherSession);

      expect(demoScope.filterRecords(records, 'fresh-session')).toEqual(real);
      expect(demoScope.filterRecords(records, 'session-one').map(function (r) { return r.id; }))
        .toEqual(real.concat(sessionOne, sessionTwo).map(function (r) { return r.id; }));
      expect(demoScope.filterRecords(records, 'session-two').map(function (r) { return r.id; }))
        .toEqual(real.concat(anotherSession).map(function (r) { return r.id; }));
      expect(demoScope.filterRecords(records, 'reload-session')).toEqual(real);
    });

    test('the committed legacy eight-record dataset is classified and hidden after restart', function () {
      const store = require('../../src/polaris/store');
      store.init();
      const customers = require('../../src/polaris/customer-engine');
      const opportunities = require('../../src/polaris/opportunity-engine');
      const communications = require('../../src/polaris/communications-engine');
      const financial = require('../../src/polaris/financial-engine');
      customers.init(); communications.init(); opportunities.init(); financial.init();
      demoScope.resetLegacyIndexForTests();

      const collections = [
        [customers.listCustomers({}).customers, 8],
        [opportunities.listOpportunities({ includeArchived: false }).opportunities, 8],
        [communications.getAllCommunications({}).communications, 24],
        [financial.listEstimates({}).estimates, 8],
      ];
      collections.forEach(function (entry) {
        expect(entry[0].filter(demoScope.isSimulation)).toHaveLength(entry[1]);
        expect(demoScope.filterRecords(entry[0], 'brand-new-session')).toHaveLength(0);
      });
    });

    test('Safari Navigation Timing semantics preserve navigation, history, and restored tabs but rotate reloads', function () {
      const restoredTabStorage = new Map();
      const direct = runDemoSession('navigate', restoredTabStorage);
      const normalNavigation = runDemoSession('navigate', restoredTabStorage);
      const historyNavigation = runDemoSession('back_forward', restoredTabStorage);
      expect(normalNavigation.id).toBe(direct.id);
      expect(historyNavigation.id).toBe(direct.id);

      const reload = runDemoSession('reload', restoredTabStorage);
      expect(reload.id).not.toBe(direct.id);
      expect(reload.isReload).toBe(true);

      const restored = runDemoSession('navigate', restoredTabStorage);
      expect(restored.id).toBe(reload.id);

      const separateTab = runDemoSession('navigate', new Map());
      expect(separateTab.id).not.toBe(restored.id);
    });
  });

  describe('canonical service-specific Polaris intelligence', function () {
    test.each(['concrete', 'roofing', 'hvac', 'plumbing'])(
      'universal %s scenario round-trips through transcript, extraction, classification, and pricing',
      function (serviceKey) {
        const scenario = pipeline.generateScenario(serviceKey, 'Pipeline Review');
        const transcript = pipeline.generateTranscript(scenario, CATALOG[serviceKey]);
        const extraction = pipeline.extractScope(transcript, scenario);
        const classification = pipeline.classifyService(transcript);
        const pricing = pipeline.calculatePricing(extraction.extracted, classification.service);
        const required = CATALOG[serviceKey].scopeSchema.required;
        expect(extraction.missing.filter(function (field) { return required.includes(field); })).toEqual([]);
        expect(extraction.extracted.jobType).toBe(scenario.job.type);
        expect(pricing.total).toBeGreaterThan(0);
      }
    );

    test('400 square-foot concrete uses concrete-only scope and Business Profile markup', function () {
      const result = buildService('concrete', {
        jobType: 'install', squareFeet: 400, finish: 'standard',
        existingRemoval: false, reinforcement: true, access: 'truck access',
      });
      expect(result.service).toBe('Concrete');
      expect(result.scope.squareFeet).toBe(400);
      expect(result.scope.linearFeet).toBeUndefined();
      expect(result.scope.gates).toBeUndefined();
      expect(result.pricingBreakdown.some(function (item) { return /Business Profile markup/.test(item.label); })).toBe(true);
      expectPriceReconciliation(result);
    });

    test('roofing scope, pricing, and confidence remain roofing-specific', function () {
      const result = buildService('roofing', {
        jobType: 'replace', squares: 24, material: 'architectural', pitch: 'walkable',
        stories: 2, existingLayers: 1, flashingReplace: true,
      });
      expect(result.serviceClassification.serviceKey).toBe('roofing');
      expect(result.scope.squares).toBe(24);
      expect(result.confidenceLevel).toBe('high');
      expectPriceReconciliation(result);
    });

    test('HVAC retains tonnage, SEER, furnace, and ductwork inputs', function () {
      const result = buildService('hvac', {
        jobType: 'replace', tonnage: 3.5, systemType: 'central AC with gas furnace',
        seer: 16, sqft: 2200, ductworkReplace: true, fuelType: 'gas', thermostat: 'smart',
      });
      expect(result.scope).toMatchObject({
        tonnage: 3.5, seer: 16, systemType: 'central AC with gas furnace',
        ductworkReplace: true, fuelType: 'gas',
      });
      expectPriceReconciliation(result);
    });

    test('emergency plumbing shows a supported diagnostic and explicit emergency adjustment', function () {
      const scope = {
        jobType: 'emergency', fixture: 'burst pipe', leakSeverity: 'gushing',
        waterShutoff: false, emergency: true, urgency: 'emergency',
      };
      const action = pipeline.selectAction([
        { text: 'A pipe burst and the active leak is flooding the room. I cannot get it to stop.' },
        { text: 'Please come out today.' },
      ], 'Emergency Customer', scope);
      const result = buildService('plumbing', scope, [], { recommendedAction: action });
      expect(result.pricingStrategy).toBe('diagnosticFee');
      expect(result.pricingBreakdown.some(function (item) { return item.category === 'emergencyAdjustment'; })).toBe(true);
      expect(result.pricingBreakdown.every(function (item) { return item.amount > 0; })).toBe(true);
      expect(result.recommendedAction).toMatchObject({ action: 'Dispatch immediately', priority: 'critical' });
      expect(result.recommendedAction.action).not.toMatch(/review|schedule/i);
      expectPriceReconciliation(result);
    });

    test('missing required data lowers confidence and prevents an unsupported exact price', function () {
      const result = buildService('concrete', { jobType: 'install' }, ['squareFeet']);
      expect(result.confidenceLevel).toBe('low');
      expect(result.customerFacingPrice).toBeNull();
      expect(result.preliminaryRange).toBeNull();
      expect(result.pricingBreakdown).toEqual([]);
      expect(result.recommendedAction).toBeTruthy();
    });

    test('public schema never exposes hidden metadata', function () {
      const result = buildService('roofing', { jobType: 'repair', squares: 10, material: 'metal' });
      const publicResult = canonicalPolaris.sanitize(Object.assign({}, result, {
        metadata: { apiKey: 'secret' }, customerPhone: '555-0100', internalPrompt: 'hidden',
      }));
      expect(Object.keys(publicResult).sort()).toEqual(canonicalPolaris.PUBLIC_FIELDS.slice().sort());
      expect(JSON.stringify(publicResult)).not.toContain('secret');
      expect(JSON.stringify(publicResult)).not.toContain('555-0100');
      expect(JSON.stringify(publicResult)).not.toContain('internalPrompt');
    });
  });

  test('dashboard UI uses a neutral pipeline and canonical communication calls', function () {
    const commandCenter = fs.readFileSync(path.join(__dirname, '../../public/dashboard/command-center.html'), 'utf8');
    const communications = fs.readFileSync(path.join(__dirname, '../../public/dashboard/communications.html'), 'utf8');
    const customerDetail = fs.readFileSync(path.join(__dirname, '../../public/js/customer-detail.js'), 'utf8');
    const simulator = fs.readFileSync(path.join(__dirname, '../../public/js/simulator.js'), 'utf8');
    expect(commandCenter).toContain('background:var(--neutral-400)');
    expect(commandCenter).not.toContain("label:'Estimates',pct:maxCount>0?Math.round(pe/maxCount*100):0,color:");
    expect(commandCenter).toContain("var canonicalServices = ['fence', 'roofing', 'hvac', 'plumbing', 'electrical', 'concrete']");
    expect(commandCenter).toContain('canonical.customerFacingPrice');
    expect(commandCenter).toContain('canonical.confidenceScore');
    expect(commandCenter).toContain('canonical.recommendedAction.action');
    expect(commandCenter).not.toContain('summary.estimatedValue');
    expect(commandCenter).not.toContain('PolarisEngine.analyzeLead(lead)');
    expect(communications).toContain('/api/v1/communications?type=call&limit=50');
    expect(commandCenter).not.toContain('window.showToast = showNotification');
    expect(fs.readFileSync(path.join(__dirname, '../../public/dashboard/leads.html'), 'utf8'))
      .not.toContain('window.showToast = showNotification');
    expect(simulator).toContain('window.genCallDraft = originalGenCall');
    expect(customerDetail).toContain("pipelineVersion !== 'canonical-polaris-v1'");
    expect(customerDetail).not.toContain('Nurture with follow-up call');
    expect(customerDetail).not.toContain('stageProb');
    expect(customerDetail).not.toContain('item.amount || item.a');
  });

  test('all four canonical pages load the shared demo-session lifecycle', function () {
    ['command-center.html', 'leads.html', 'communications.html', 'polaris.html'].forEach(function (file) {
      const html = fs.readFileSync(path.join(__dirname, '../../public/dashboard', file), 'utf8');
      expect(html).toContain('/js/demo-session.js');
    });
  });

  test('session-scoped analytics retain durable tenant operational context', function () {
    const loader = require('../../src/services/dataLoader');
    const base = loader.loadData();
    const scoped = loader.loadCanonicalData('brand-new-session');
    const durableLeadIds = (base.leads || []).filter(function (lead) {
      return !demoScope.isSimulation(lead) && !lead.canonicalOpportunityId;
    }).map(function (lead) { return lead.id; });
    const scopedLeadIds = scoped.leads.map(function (lead) { return lead.id; });

    durableLeadIds.forEach(function (id) { expect(scopedLeadIds).toContain(id); });
    expect(scoped.recommendations.every(function (wrapper) {
      return demoScope.canAccess(wrapper.data || wrapper, 'brand-new-session');
    })).toBe(true);
    expect(scoped.metrics).toEqual(base.metrics);

    const tenantJob = { id: 'real-job' };
    const linkedTenantLead = { id: 'real-linked-lead', canonicalOpportunityId: 'real-opportunity' };
    const activeDemoJob = { id: 'active-job', metadata: demoScope.createMetadata('brand-new-session') };
    const otherDemoJob = { id: 'other-job', metadata: demoScope.createMetadata('other-session') };
    expect(loader.filterSessionRecords([linkedTenantLead], 'brand-new-session')).toEqual([linkedTenantLead]);
    expect(loader.filterSessionRecords([tenantJob, activeDemoJob, otherDemoJob], 'brand-new-session'))
      .toEqual([tenantJob, activeDemoJob]);
    expect(loader.filterSessionRecords([
      { id: 'real-wrapper', data: tenantJob },
      { id: 'other-wrapper', data: otherDemoJob },
    ], 'brand-new-session').map(function (wrapper) { return wrapper.id; }))
      .toEqual(['real-wrapper']);
  });

  describe('Polaris page rendering states', function () {
    function loadPage(theme) {
      const elements = {};
      [
        'polarisRoot', 'polarisIntelligencePanel', 'polarisCanonicalService',
        'polarisCanonicalPrice', 'polarisCanonicalConfidence', 'polarisCanonicalAction',
        'polarisCanonicalScope', 'polarisCanonicalMissing', 'polarisCanonicalAssumptions',
      ].forEach(function (id) {
        elements[id] = {
          textContent: '',
          attributes: {},
          setAttribute: function (name, value) { this.attributes[name] = value; },
        };
      });
      const document = {
        documentElement: { dataset: { theme: theme } },
        getElementById: function (id) { return elements[id] || null; },
      };
      const window = {};
      const code = fs.readFileSync(path.join(__dirname, '../../public/js/polaris-page.js'), 'utf8');
      vm.runInNewContext(code, {
        window: window, document: document, Promise: Promise, JSON: JSON,
        Object: Object, Number: Number, String: String, isFinite: isFinite,
      });
      return { page: window.PolarisPage, elements: elements };
    }

    test.each(['light', 'dark'])('%s theme renders canonical content without a blank root', async function (theme) {
      const loaded = loadPage(theme);
      const canonical = buildService('concrete', {
        jobType: 'install', squareFeet: 400, finish: 'standard',
        existingRemoval: false, reinforcement: true, access: 'truck access',
      });
      await loaded.page.init({
        getOpportunities: function () {
          return Promise.resolve({ opportunities: [{ metadata: { polarisIntelligence: canonical } }] });
        },
      });
      expect(loaded.elements.polarisRoot.attributes['data-render-state']).toBe('canonical');
      expect(loaded.elements.polarisCanonicalService.textContent).toBe('Concrete');
      expect(loaded.elements.polarisCanonicalPrice.textContent).toMatch(/^\$/);
      expect(loaded.elements.polarisCanonicalConfidence.textContent).toBe('90%');
      expect(loaded.elements.polarisCanonicalAction.textContent).toBe('Review and schedule');
    });

    test('loading, empty, and error states are explicit', async function () {
      const loading = loadPage('light');
      let finish;
      const pending = loading.page.init({
        getOpportunities: function () {
          return new Promise(function (resolve) { finish = resolve; });
        },
      });
      expect(loading.elements.polarisRoot.attributes['data-render-state']).toBe('loading');
      finish({ opportunities: [] });
      await pending;
      expect(loading.elements.polarisRoot.attributes['data-render-state']).toBe('empty');

      const failed = loadPage('dark');
      await failed.page.init({
        getOpportunities: function () { return Promise.reject(new Error('offline')); },
      });
      expect(failed.elements.polarisRoot.attributes['data-render-state']).toBe('error');
    });

    test('page contains one active render root and themed state styling', function () {
      const html = fs.readFileSync(path.join(__dirname, '../../public/dashboard/polaris.html'), 'utf8');
      expect((html.match(/id="polarisRoot"/g) || [])).toHaveLength(1);
      expect((html.match(/id="polarisIntelligencePanel"/g) || [])).toHaveLength(1);
      expect(html).toContain('/js/theme.js');
      expect(html).toContain('[data-theme="dark"] .polaris-intelligence-panel');
      expect(html).toContain('data-polaris-state="loading"');
      expect(html).toContain('data-polaris-state="empty"');
      expect(html).toContain('data-polaris-state="error"');
      expect(html).toContain('data-polaris-state="canonical"');
    });
  });
});
