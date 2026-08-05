'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const ENGINE_PATH = path.join(ROOT, 'public', 'js', 'polaris-engine.js');
const UI_PATH = path.join(ROOT, 'public', 'js', 'polaris-ui.js');
const CALENDAR_PATH = path.join(ROOT, 'public', 'js', 'calendar-engine.js');
const CUSTOMER_DETAIL_PATH = path.join(ROOT, 'public', 'js', 'customer-detail.js');
const LEAD_PATH = path.join(ROOT, 'public', 'dashboard', 'lead.html');
const {
  CALCULATION_VERSION,
  calculateCanonicalPolaris,
} = require('../../src/services/canonicalPolarisCalculation');
const {
  canonicalFenceProfile,
  canonicalFenceScope,
} = require('../helpers/m19-part3-business-profile');

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
    laborHours: 0,
    knownInternalLaborCost: 0,
    estimatedProductionDurationHours: 0,
    materialsCharge: 0,
    equipmentCharge: 0,
    travel: Object.freeze({ minutes: 0, distanceMiles: 0 }),
    notCalculated: Object.freeze([]),
  }, overrides || {}));
}

function productionCalculation(overrides) {
  return calculateCanonicalPolaris(Object.assign({
    organizationId: '00000000-0000-0000-0000-000000000083',
    customerId: '10000000-0000-0000-0000-000000000083',
    opportunityId: '20000000-0000-0000-0000-000000000083',
    calculationVersion: CALCULATION_VERSION,
    service: { key: 'fence', scope: canonicalFenceScope() },
    transcript: [
      { turnId: 'turn-1', speaker: 'customer', text: 'I need a new 100-foot cedar fence and the existing fence removed.' },
      { turnId: 'turn-2', speaker: 'customer', text: 'Please include one walk gate. Weekday mornings work best. This is not an emergency.' },
    ],
    facts: [
      { id: 'fact-linear-feet', variable: 'linearFeet', status: 'collected', normalizedValue: 100, evidenceTurnId: 'turn-1' },
      { id: 'fact-material', variable: 'material', status: 'collected', normalizedValue: 'cedar', evidenceTurnId: 'turn-1' },
      { id: 'fact-removal', variable: 'removalRequired', status: 'collected', normalizedValue: true, evidenceTurnId: 'turn-1' },
      { id: 'fact-gate', variable: 'gates', status: 'collected', normalizedValue: [{ type: 'walk' }], evidenceTurnId: 'turn-2' },
    ],
    businessProfile: canonicalFenceProfile(),
    businessProfileAuthority: {
      id: '30000000-0000-0000-0000-000000000083',
      versionLabel: 'm19-part4-slice3-production-output-v1',
      profileHash: 'b'.repeat(64),
    },
    appointmentPreference: { dayPart: 'morning', days: ['weekday'] },
    travel: null,
    callDurationSeconds: 242,
    actualCrewAssignment: null,
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

function runSharedCard(values) {
  const loaded = createSandbox(values);
  const document = createDocument();
  const ids = [
    'polarisTopOpp', 'polarisTopOppDesc', 'polarisTopConf',
    'polarisPipeline', 'polarisPipeConf', 'polarisFocus',
    'polarisFocusDesc', 'polarisFocusConf',
  ];
  loaded.sandbox.document = document;
  loaded.sandbox.window.document = document;
  ids.forEach(function (id) { document.getElementById(id).textContent = 'stale-value'; });
  loaded.sandbox.window.PolarisEngine.renderPolarisCard();
  return ids.reduce(function (result, id) {
    result[id] = document.getElementById(id).textContent;
    return result;
  }, {});
}

function canonicalEnvelope(values) {
  return Object.freeze({
    ids: Object.freeze({ opportunity: 'lead-1', customer: 'customer-1' }),
    calculationVersion: 'canonical-v-test',
    snapshotDigest: 'presentation-digest',
    values: values,
  });
}

function domElement() {
  var text = '';
  var html = null;
  var children = [];
  var classes = new Set();
  var node = {
    id: '',
    className: '',
    style: {},
    dataset: {},
    children: children,
    value: '',
    scrollTop: 0,
    addEventListener: function () {},
    focus: function () {},
    remove: function () {},
    replaceWith: function () {},
    cloneNode: function () { return domElement(); },
    appendChild: function (child) {
      html = null;
      children.push(child);
      return child;
    },
    replaceChildren: function () {
      html = null;
      text = '';
      children.length = 0;
      Array.prototype.forEach.call(arguments, function (child) { children.push(child); });
    },
  };
  node.classList = {
    add: function (name) { classes.add(name); },
    remove: function (name) { classes.delete(name); },
    contains: function (name) { return classes.has(name); },
  };
  Object.defineProperties(node, {
    textContent: {
      get: function () {
        return text + children.map(function (child) { return child.textContent || ''; }).join('');
      },
      set: function (value) {
        text = value == null ? '' : String(value);
        html = null;
        children.length = 0;
      },
    },
    innerHTML: {
      get: function () {
        if (html !== null) return html;
        return escapeHtml(text) + children.map(function (child) { return child.innerHTML || ''; }).join('');
      },
      set: function (value) {
        html = value == null ? '' : String(value);
        text = '';
        children.length = 0;
      },
    },
    firstElementChild: {
      get: function () { return children[0] || null; },
    },
  });
  return node;
}

function createDocument() {
  var elements = Object.create(null);
  var listeners = [];
  var body = domElement();
  body.style = {};
  return {
    body: body,
    readyState: 'complete',
    hidden: false,
    createElement: function () { return domElement(); },
    getElementById: function (id) {
      if (!elements[id]) {
        elements[id] = domElement();
        elements[id].id = id;
      }
      return elements[id];
    },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    addEventListener: function (name, callback) { listeners.push({ name: name, callback: callback }); },
    elements: elements,
    listeners: listeners,
  };
}

function createConsumerRuntime(source, options) {
  options = options || {};
  var document = createDocument();
  var values = canonicalValues();
  var item = canonicalEnvelope(values);
  var windowListeners = [];
  var canonicalIntelligence = options.canonicalIntelligence || {
    getPresentation: function () { return source; },
    getProjection: function () {
      return {
        items: [item],
        records: options.records || [],
        metrics: { estimatedRevenue: values.estimatedRevenue },
      };
    },
    loadCompatibility: function () { return Promise.resolve({ items: [item], records: [], digest: 'presentation-digest' }); },
  };
  var sandbox = {
    window: {
      CanonicalIntelligence: canonicalIntelligence,
      addEventListener: function (name, callback) { windowListeners.push({ name: name, callback: callback }); },
      location: { href: 'https://northstar.test/dashboard/lead?id=lead-1' },
    },
    document: document,
    console: console,
    Object: Object,
    Array: Array,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Promise: Promise,
    Date: Date,
    URL: URL,
    Set: Set,
    Map: Map,
    JSON: JSON,
    Math: Math,
    isNaN: isNaN,
    parseFloat: parseFloat,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    confirm: function () { return false; },
    alert: function () {},
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = document;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ENGINE_PATH, 'utf8'), sandbox, { filename: 'polaris-engine.js' });
  var productionSelector = sandbox.window.PolarisEngine.selectPresentation;
  var selectorCalls = [];
  sandbox.window.PolarisEngine = {
    selectPresentation: function (candidate) {
      selectorCalls.push(candidate);
      return productionSelector(candidate);
    },
  };
  return {
    document: document,
    sandbox: sandbox,
    selectorCalls: selectorCalls,
  };
}

function runPolarisUi(source) {
  var runtime = createConsumerRuntime(source);
  vm.runInContext(fs.readFileSync(UI_PATH, 'utf8'), runtime.sandbox, { filename: 'polaris-ui.js' });
  var container = domElement();
  runtime.sandbox.window.PolarisUI.render(container, source);
  return { html: container.innerHTML, selectorCalls: runtime.selectorCalls };
}

function runCalendar(source, includeEvent) {
  var record = {
    id: 'appointment-1',
    scheduledStart: '2026-08-05T13:00:00.000Z',
    scheduledEnd: '2026-08-05T14:00:00.000Z',
    customer: { name: 'Avery <Cedar>', phone: '555-0100', address: '1 & Main' },
    status: 'scheduled',
    canonical: source,
  };
  var runtime = createConsumerRuntime(source, { records: includeEvent ? [record] : [] });
  vm.runInContext(fs.readFileSync(CALENDAR_PATH, 'utf8'), runtime.sandbox, { filename: 'calendar-engine.js' });
  runtime.sandbox.window.calRenderer.renderPolaris();
  var events = includeEvent ? runtime.sandbox.window.syncCalendarFromAppStore() : [];
  return {
    html: runtime.document.getElementById('calendarPolaris').innerHTML,
    events: events,
    selectorCalls: runtime.selectorCalls,
  };
}

async function runCustomerDetail(source) {
  var projections = {
    'customer-detail': { digest: 'customer-digest', records: [{ id: 'customer-1', name: 'Avery <Cedar>', status: 'active' }], items: [source] },
    leads: { digest: 'customer-digest', records: [{ id: 'lead-1', status: 'qualified' }], items: [] },
    estimates: { digest: 'customer-digest', records: [], items: [] },
    communications: { digest: 'customer-digest', records: [], items: [] },
  };
  var canonicalIntelligence = {
    getProjection: function () { return null; },
    loadCompatibility: function (surface) { return Promise.resolve(projections[surface]); },
  };
  var runtime = createConsumerRuntime(source, { canonicalIntelligence: canonicalIntelligence });
  runtime.sandbox.window.NorthStarAccountSession = {
    fetch: function () { return Promise.reject(new Error('unexpected account fetch')); },
  };
  vm.runInContext(fs.readFileSync(CUSTOMER_DETAIL_PATH, 'utf8'), runtime.sandbox, { filename: 'customer-detail.js' });
  runtime.sandbox.window.CustomerDetail.open('customer-1');
  await new Promise(function (resolve) { setImmediate(resolve); });
  await Promise.resolve();
  return {
    summary: runtime.document.getElementById('cdPolSummary'),
    price: runtime.document.getElementById('cdPolPrice'),
    confidence: runtime.document.getElementById('cdPolConfidence'),
    revenue: runtime.document.getElementById('cdPolRevenue'),
    action: runtime.document.getElementById('cdPolAction'),
    loading: runtime.document.getElementById('cdDrawerLoading'),
    selectorCalls: runtime.selectorCalls,
  };
}

function leadInlineScript() {
  var html = fs.readFileSync(LEAD_PATH, 'utf8');
  var scripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
    .filter(function (match) { return !/\bsrc\s*=/.test(match[1]); })
    .map(function (match) { return match[2]; });
  if (scripts.length !== 1) throw new Error('Expected one complete Lead inline script, found ' + scripts.length);
  return scripts[0];
}

async function runLead(source) {
  var runtime = createConsumerRuntime(source);
  var PolarisApi = {
    getOpportunities: function () {
      return Promise.resolve({ opportunities: [{ canonical: { ids: { opportunity: 'lead-1' } } }] });
    },
    normalizeLead: function () {
      return {
        id: 'lead-1',
        callerName: 'Avery Cedar',
        service: 'Zero service',
        estimatedPrice: 0,
        status: 'qualified',
        canonical: source,
      };
    },
  };
  runtime.sandbox.PolarisApi = PolarisApi;
  runtime.sandbox.window.PolarisApi = PolarisApi;
  vm.runInContext(leadInlineScript(), runtime.sandbox, { filename: 'lead.html:inline' });
  await new Promise(function (resolve) { setImmediate(resolve); });
  await Promise.resolve();
  return {
    primary: runtime.document.getElementById('polarisContainer'),
    customer: runtime.document.getElementById('customerIntelligenceContainer'),
    loading: runtime.document.getElementById('loadingState'),
    selectorCalls: runtime.selectorCalls,
  };
}

function dynamicValues(action) {
  return canonicalValues({
    service: Object.freeze({
      key: 'zero-service',
      label: 'Zero & <Service>',
      scope: 'Scope <safe> & complete',
    }),
    recommendedActions: Object.freeze([action]),
  });
}

const INVALID_NESTED_VALUES = [
  ['an empty service object', function () {
    return canonicalValues({ service: Object.freeze({}) });
  }],
  ['a non-string service key', function () {
    return canonicalValues({ service: Object.freeze({ key: 42, label: 'Fence' }) });
  }],
  ['a non-string service label', function () {
    return canonicalValues({ service: Object.freeze({ key: 'fence', label: 42 }) });
  }],
  ['an empty confidence object', function () {
    return canonicalValues({ confidence: Object.freeze({}) });
  }],
  ['an empty risk object', function () {
    return canonicalValues({ risk: Object.freeze({}) });
  }],
  ['a string false emergency value', function () {
    return canonicalValues({ risk: Object.freeze({ emergency: 'false' }) });
  }],
  ['an empty recommendation record', function () {
    return canonicalValues({ recommendedActions: Object.freeze([Object.freeze({})]) });
  }],
  ['a numeric recommendation', function () {
    return canonicalValues({ recommendedActions: Object.freeze([42]) });
  }],
  ['a non-string selected recommendation field', function () {
    return canonicalValues({ recommendedActions: Object.freeze([Object.freeze({ action: 42 })]) });
  }],
];

const INVALID_NESTED_SOURCES = INVALID_NESTED_VALUES.map(function (entry) {
  return [entry[0], function () { return canonicalEnvelope(entry[1]()); }];
});

const INVALID_SELECTOR_SOURCES = [
  ['null', function () { return null; }],
  ['undefined', function () { return undefined; }],
  ['an empty raw object', function () { return {}; }],
  ['an explicit null values wrapper', function () { return { values: null }; }],
  ['an empty values wrapper', function () { return { values: {} }; }],
  ['a string', function () { return 'not-canonical'; }],
  ['a number', function () { return 42; }],
  ['an array', function () { return []; }],
  ['a malformed numeric projection', function () {
    return canonicalEnvelope(canonicalValues({ customerFacingPrice: 'not-a-number' }));
  }],
  ['a non-finite numeric projection', function () {
    return canonicalEnvelope(canonicalValues({ grossProfit: Infinity }));
  }],
  ['a NaN numeric projection', function () {
    return canonicalEnvelope(canonicalValues({ grossProfit: NaN }));
  }],
  ['an explicitly invalid higher-priority wrapper', function () {
    return { canonicalValues: null, values: canonicalValues(), snapshot: canonicalValues() };
  }],
  ['an explicitly invalid values wrapper with a stale snapshot', function () {
    return { values: null, snapshot: canonicalValues() };
  }],
].concat(INVALID_NESTED_SOURCES);

const INVALID_CONSUMER_SOURCES = [
  ['null', function () { return null; }],
  ['undefined', function () { return undefined; }],
  ['empty raw object', function () { return {}; }],
  ['explicit null wrapper', function () { return { values: null }; }],
  ['empty wrapped projection', function () { return { values: {} }; }],
  ['malformed numeric projection', function () {
    return canonicalEnvelope(canonicalValues({
      service: Object.freeze({ key: 'bad-service', label: 'Bad service', scope: 'Bad scope' }),
      customerFacingPrice: 'not-a-number',
    }));
  }],
  ['stale higher-priority wrapper', function () {
    return { canonicalValues: null, values: dynamicValues('Stale action'), snapshot: dynamicValues('Stale snapshot') };
  }],
].concat(INVALID_NESTED_SOURCES);

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
      service: null,
      customerFacingPrice: null,
      confidence: null,
      grossProfit: null,
      recommendedActions: null,
      risk: null,
    });
    const selected = createSandbox(values).sandbox.window.PolarisEngine.selectPresentation({ values: values });

    expect(selected.service).toBeNull();
    expect(selected.serviceText).toBe('');
    expect(selected.customerPrice).toBeNull();
    expect(selected.customerPriceText).toBe('Not calculated');
    expect(selected.customerPriceRoundedText).toBe('Not calculated');
    expect(selected.confidence).toBeNull();
    expect(selected.confidenceScore).toBeNull();
    expect(selected.confidenceText).toBe('Not calculated');
    expect(selected.grossProfit).toBeNull();
    expect(selected.grossProfitText).toBe('Not calculated');
    expect(selected.risk).toBeNull();
    expect(selected.riskText).toBe('null');
    expect(selected.recommendations).toBeNull();
    expect(selected.recommendedActionText).toBe('');
  });

  test.each(INVALID_SELECTOR_SOURCES)('fails closed for %s', (_label, createSource) => {
    const selector = createSandbox(canonicalValues()).sandbox.window.PolarisEngine.selectPresentation;
    expect(selector(createSource())).toBeNull();
  });

  test('preserves action strings and action objects without interpreting presentation text', () => {
    const selector = createSandbox(canonicalValues()).sandbox.window.PolarisEngine.selectPresentation;
    const stringAction = selector({ values: dynamicValues('Dispatch <crew> & confirm') });
    const objectAction = selector({ values: dynamicValues(Object.freeze({ action: 'Call <owner> & confirm' })) });

    expect(stringAction.recommendedActionText).toBe('Dispatch <crew> & confirm');
    expect(objectAction.recommendedActionText).toBe('Call <owner> & confirm');
  });

  test('accepts the authentic calculator labeled recommendation without rewriting its values', () => {
    const values = productionCalculation();
    const selector = createSandbox(values).sandbox.window.PolarisEngine.selectPresentation;

    expect(values.recommendedActions).toEqual([{
      code: 'schedule-estimate',
      label: 'Schedule the requested estimate window',
      priority: 'high',
    }]);
    const selected = selector({ values: values });
    expect(selected).not.toBeNull();
    expect(selected.values).toBe(values);
    expect(selected.recommendedActionText).toBe('Schedule the requested estimate window');
  });

  test('renders authentic calculator output through the complete real PolarisUI consumer', () => {
    const values = productionCalculation();
    const source = canonicalEnvelope(values);
    const result = runPolarisUi(source);

    expect(result.selectorCalls).toEqual([source]);
    expect(result.html).toContain('data-canonical-presentation="true"');
    expect(result.html).toContain('Persisted Profile Fence');
    expect(result.html).toContain('Schedule the requested estimate window');
    expect(result.html).not.toContain('Canonical intelligence unavailable');
    expect(result.html).not.toContain('$NaN');
  });

  test('accepts and renders the authentic unsupported-service output with its null label', () => {
    const values = productionCalculation({ service: { key: 'roofing', scope: {} } });
    const source = canonicalEnvelope(values);
    const selector = createSandbox(values).sandbox.window.PolarisEngine.selectPresentation;

    expect(values.service).toMatchObject({
      key: 'roofing',
      label: null,
      supported: false,
      unpricedReason: 'service_not_configured',
    });
    const selected = selector(source);
    expect(selected).not.toBeNull();
    expect(selected.serviceText).toBe('roofing');
    expect(selected.customerPriceText).toBe('Not calculated');
    expect(selected.recommendedActionText).toBe('Schedule the requested estimate window');

    const result = runPolarisUi(source);
    expect(result.selectorCalls).toEqual([source]);
    expect(result.html).toContain('data-canonical-presentation="true"');
    expect(result.html).toContain('>roofing<');
    expect(result.html).toContain('Schedule the requested estimate window');
    expect(result.html).not.toContain('Canonical intelligence unavailable');
    expect(result.html).not.toContain('$NaN');
  });

  test('accepts each explicit valid envelope without changing the canonical values identity', () => {
    const values = canonicalValues();
    const selector = createSandbox(values).sandbox.window.PolarisEngine.selectPresentation;

    expect(selector(values).values).toBe(values);
    expect(selector({ canonicalValues: values }).values).toBe(values);
    expect(selector({ values: values }).values).toBe(values);
    expect(selector({ snapshot: values }).values).toBe(values);
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

  test('shared Polaris card clears every presentation field when canonical values are malformed', () => {
    const rendered = runSharedCard(canonicalValues({ customerFacingPrice: 'not-a-number' }));

    expect(Object.values(rendered)).toEqual(Array(8).fill('\u2014'));
  });

  test.each(INVALID_NESTED_VALUES)('shared Polaris card clears stale fields for %s', (_label, createValues) => {
    const rendered = runSharedCard(createValues());

    expect(Object.values(rendered)).toEqual(Array(8).fill('\u2014'));
    expect(rendered.polarisFocusConf).not.toBe('Emergency evidence');
  });

  test('real PolarisUI delegates at runtime and preserves zero, object-action, and escaping semantics', () => {
    const source = canonicalEnvelope(dynamicValues(Object.freeze({ action: 'Call <owner> & confirm' })));
    const result = runPolarisUi(source);

    expect(result.selectorCalls).toEqual([source]);
    expect(result.html).toContain('data-canonical-presentation="true"');
    expect(result.html).toContain('Zero &amp; &lt;Service&gt;');
    expect(result.html).toContain('>$0<');
    expect(result.html).toContain('>0%<');
    expect(result.html).toContain('Call &lt;owner&gt; &amp; confirm');
    expect(result.html).not.toContain('Call <owner>');
  });

  test('real Calendar delegates both rendering and event projection with valid zero and escaped string action', () => {
    const source = canonicalEnvelope(dynamicValues('Dispatch <crew> & confirm'));
    const result = runCalendar(source, true);

    expect(result.selectorCalls).toEqual([source, source]);
    expect(result.html).not.toContain('Canonical intelligence unavailable');
    expect(result.html).toContain('$0');
    expect(result.html).toContain('0%');
    expect(result.html).toContain('Dispatch &lt;crew&gt; &amp; confirm');
    expect(result.html).not.toContain('Dispatch <crew>');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].serviceType).toBe('Zero & <Service>');
    expect(result.events[0].estimatedPrice).toBe(0);
    expect(result.events[0].duration).toBe(0);
  });

  test('real CustomerDetail load/render pipeline delegates and preserves valid zero and safe object action', async () => {
    const values = dynamicValues(Object.freeze({ action: 'Call <owner> & confirm' }));
    const source = canonicalEnvelope(values);
    const result = await runCustomerDetail(source);

    expect(result.selectorCalls).toEqual([source, values]);
    expect(result.loading.innerHTML).not.toContain('Failed to load customer data');
    expect(result.summary.textContent).toBe('Zero & <Service>');
    expect(result.summary.innerHTML).toBe('Zero &amp; &lt;Service&gt;');
    expect(result.price.textContent).toBe('$0');
    expect(result.confidence.innerHTML).toContain('Server confidence (0%)');
    expect(result.revenue.textContent).toBe('$0');
    expect(result.action.textContent).toBe('Call <owner> & confirm');
    expect(result.action.innerHTML).toBe('Call &lt;owner&gt; &amp; confirm');
  });

  test('real Lead inline load/render pipeline delegates twice and preserves valid zero and safe string action', async () => {
    const source = canonicalEnvelope(dynamicValues('Dispatch <crew> & confirm'));
    const result = await runLead(source);

    expect(result.selectorCalls).toEqual([source, source]);
    expect(result.loading.innerHTML).not.toContain('Lead not found');
    expect(result.primary.textContent).toContain('Canonical Polaris');
    expect(result.primary.textContent).toContain('Customer price: 0');
    expect(result.primary.textContent).toContain('Dispatch <crew> & confirm');
    expect(result.primary.innerHTML).toContain('Dispatch &lt;crew&gt; &amp; confirm');
    expect(result.primary.innerHTML).not.toContain('Dispatch <crew>');
    expect(result.customer.textContent).toContain('Canonical Polaris');
  });

  describe.each(INVALID_CONSUMER_SOURCES)('fail-closed consumer DOM for %s', (_label, createSource) => {
    test('PolarisUI delegates dynamically and renders only unavailable state', () => {
      const source = createSource();
      const result = runPolarisUi(source);

      expect(result.selectorCalls).toEqual([source]);
      expect(result.html).toContain('Canonical intelligence unavailable');
      expect(result.html).not.toContain('data-canonical-presentation="true"');
      expect(result.html).not.toContain('$NaN');
    });

    test('Calendar delegates dynamically and renders only unavailable state', () => {
      const source = createSource();
      const result = runCalendar(source, false);

      expect(result.selectorCalls).toEqual([source]);
      expect(result.html).toContain('Canonical intelligence unavailable');
      expect(result.html).not.toContain('$NaN');
    });

    test('CustomerDetail delegates dynamically and renders canonical-unavailable values', async () => {
      const source = createSource();
      const result = await runCustomerDetail(source);

      expect(result.selectorCalls[0]).toBe(source === undefined ? null : source);
      expect(result.selectorCalls).toHaveLength(2);
      expect(result.loading.innerHTML).not.toContain('Failed to load customer data');
      expect(result.summary.textContent).toBe('Canonical intelligence unavailable.');
      expect(result.price.textContent).toBe('\u2014');
      expect(result.action.textContent).toBe('\u2014');
      expect(result.summary.innerHTML).not.toContain('$NaN');
    });

    test('Lead inline renderer delegates dynamically and renders two unavailable placeholders', async () => {
      const source = createSource();
      const result = await runLead(source);

      expect(result.selectorCalls).toHaveLength(2);
      expect(result.loading.innerHTML).not.toContain('Lead not found');
      expect(result.primary.textContent).toBe('Canonical intelligence unavailable.');
      expect(result.customer.textContent).toBe('Canonical intelligence unavailable.');
      expect(result.primary.innerHTML).not.toContain('$NaN');
    });
  });
});
