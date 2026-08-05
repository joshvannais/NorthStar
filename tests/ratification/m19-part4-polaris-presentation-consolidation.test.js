'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const ENGINE_PATH = path.join(ROOT, 'public', 'js', 'polaris-engine.js');
const UI_PATH = path.join(ROOT, 'public', 'js', 'polaris-ui.js');

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
  });
}

function element() {
  var text = '';
  return {
    get textContent() { return text; },
    set textContent(value) { text = value == null ? '' : String(value); },
    get innerHTML() { return escapeHtml(text); },
    set innerHTML(value) { text = value == null ? '' : String(value); },
  };
}

function canonicalValues(overrides) {
  return Object.freeze(Object.assign({
    service: Object.freeze({ key: 'zero-service', label: 'Zero & <Service>', scope: Object.freeze({ units: 0 }) }),
    customerFacingPrice: 0,
    confidence: Object.freeze({ score: 0, label: 'Evidence pending' }),
    grossProfit: 0,
    grossMarginPercent: 0,
    netProfit: 0,
    netMarginPercent: 0,
    estimatedRevenue: 0,
    recommendedActions: Object.freeze([Object.freeze({ action: 'Call <owner> & confirm', rank: 1 })]),
    risk: Object.freeze({ emergency: false, level: 'low' }),
    totalIncludingTax: 0,
    subtotalBeforeTax: 0,
    tax: 0,
    taxRatePercent: 0,
    taxDisposition: Object.freeze({ status: 'calculated' }),
    pricingLineItems: Object.freeze([]),
    laborCharge: 0,
    materialsCharge: 0,
    equipmentCharge: 0,
    travel: Object.freeze({ minutes: 0, distanceMiles: 0 }),
    notCalculated: Object.freeze([]),
  }, overrides || {}));
}

function createSandbox(values) {
  const item = {
    ids: { graph: 'presentation-graph' },
    calculationVersion: 'canonical-v-test',
    snapshotDigest: 'presentation-digest',
    values: values,
  };
  const listeners = [];
  const sandbox = {
    window: {
      CanonicalIntelligence: {
        getProjection: function () { return { items: [item], metrics: { estimatedRevenue: values.estimatedRevenue } }; },
        loadCompatibility: function () { return Promise.resolve({ items: [item] }); },
      },
      addEventListener: function (name, callback) { listeners.push({ name: name, callback: callback }); },
    },
    document: {
      createElement: element,
      getElementById: function () { return null; },
    },
    console: console,
    Object: Object,
    Array: Array,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Promise: Promise,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ENGINE_PATH, 'utf8'), sandbox, { filename: 'polaris-engine.js' });
  return { item: item, listeners: listeners, sandbox: sandbox };
}

describe('Mission 19 Part 4 Slice 3 shared Polaris presentation selector', () => {
  test('selects and formats persisted canonical fields without collapsing explicit zero', () => {
    const values = canonicalValues();
    const loaded = createSandbox(values);
    const selector = loaded.sandbox.window.PolarisEngine.selectPresentation;

    expect(typeof selector).toBe('function');
    const selected = selector({ values: values });

    expect(selected.values).toBe(values);
    expect(selected.service).toBe(values.service);
    expect(selected.serviceText).toBe('Zero & <Service>');
    expect(selected.customerPrice).toBe(0);
    expect(selected.customerPriceText).toBe('$0');
    expect(selected.customerPriceRoundedText).toBe('$0');
    expect(selected.confidence).toBe(values.confidence);
    expect(selected.confidenceScore).toBe(0);
    expect(selected.confidenceText).toBe('0%');
    expect(selected.grossProfit).toBe(0);
    expect(selected.grossProfitText).toBe('$0');
    expect(selected.risk).toBe(values.risk);
    expect(selected.riskText).toBe('{"emergency":false,"level":"low"}');
    expect(selected.recommendations).toBe(values.recommendedActions);
    expect(selected.recommendedActionText).toBe('Call <owner> & confirm');
    expect(Object.isFrozen(selected)).toBe(true);
    expect(values.customerFacingPrice).toBe(0);
  });

  test('preserves null as Not calculated instead of fabricating zero', () => {
    const values = canonicalValues({
      customerFacingPrice: null,
      confidence: Object.freeze({ score: null }),
      grossProfit: null,
      recommendedActions: Object.freeze([]),
      risk: null,
    });
    const selected = createSandbox(values).sandbox.window.PolarisEngine.selectPresentation({ values: values });

    expect(selected.customerPrice).toBeNull();
    expect(selected.customerPriceText).toBe('Not calculated');
    expect(selected.customerPriceRoundedText).toBe('Not calculated');
    expect(selected.confidenceScore).toBeNull();
    expect(selected.confidenceText).toBe('Not calculated');
    expect(selected.grossProfit).toBeNull();
    expect(selected.grossProfitText).toBe('Not calculated');
    expect(selected.risk).toBeNull();
    expect(selected.riskText).toBe('null');
    expect(selected.recommendedActionText).toBe('');
  });

  test('legacy PolarisEngine presentation remains a selector over the same canonical object', () => {
    const values = canonicalValues();
    const loaded = createSandbox(values);
    const presentation = loaded.sandbox.window.PolarisEngine.analyzeLead({ id: 'presentation-graph' });

    expect(presentation.canonicalValues).toBe(values);
    expect(presentation.service).toBe(values.service);
    expect(presentation.estimatedPrice).toBe(0);
    expect(presentation.confidence).toBe(0);
    expect(presentation.grossProfit).toBe(0);
    expect(presentation.risk).toBe(values.risk);
    expect(presentation.recommendations).toBe(values.recommendedActions);
    expect(presentation.insight).toBe('Call <owner> & confirm');
  });

  test('real PolarisUI consumes the selector and preserves its exact escaped card semantics', () => {
    const values = canonicalValues();
    const loaded = createSandbox(values);
    const productionSelector = loaded.sandbox.window.PolarisEngine.selectPresentation;
    var selectorCalls = 0;
    loaded.sandbox.window.PolarisEngine = {
      selectPresentation: function (source) {
        selectorCalls += 1;
        return productionSelector(source);
      },
    };

    vm.runInContext(fs.readFileSync(UI_PATH, 'utf8'), loaded.sandbox, { filename: 'polaris-ui.js' });
    const container = { innerHTML: '' };
    loaded.sandbox.window.PolarisUI.render(container, { values: values });

    expect(selectorCalls).toBe(1);
    expect(container.innerHTML).toContain('Zero &amp; &lt;Service&gt;');
    expect(container.innerHTML).toContain('>$0<');
    expect(container.innerHTML).toContain('>0%<');
    expect(container.innerHTML).toContain('Call &lt;owner&gt; &amp; confirm');
    expect(container.innerHTML).not.toContain('Call <owner>');
  });

  test('every frozen mounted consumer delegates canonical field selection to PolarisEngine', () => {
    const consumers = [
      'public/js/polaris-ui.js',
      'public/js/calendar-engine.js',
      'public/js/customer-detail.js',
      'public/dashboard/lead.html',
    ];
    for (const relative of consumers) {
      const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      expect(source).toMatch(/PolarisEngine\.selectPresentation\s*\(/);
    }
  });
});
