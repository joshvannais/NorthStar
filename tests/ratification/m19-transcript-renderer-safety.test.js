'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const RENDERER_PATH = path.join(ROOT, 'public', 'js', 'transcript-renderer.js');
const CUSTOMER_DETAIL_PATH = path.join(ROOT, 'public', 'js', 'customer-detail.js');
const INDEX_PATH = path.join(ROOT, 'public', 'index.html');
const LEAD_PATH = path.join(ROOT, 'public', 'dashboard', 'lead.html');
const CUSTOMER_DETAIL_CONSUMERS = [
  path.join(ROOT, 'public', 'dashboard', 'leads.html'),
  path.join(ROOT, 'public', 'dashboard', 'communications.html'),
  path.join(ROOT, 'public', 'dashboard', 'command-center.html'),
];

const IMAGE_PAYLOAD = '<img src="/m19-transcript-attack-unit" onerror="window.__m19TranscriptXss=1">';
const CLOSING_PAYLOAD = '</div><script>window.__m19TranscriptScript=1</script><svg onload="window.__m19TranscriptSvg=1">';
const LABEL_PAYLOAD = '<img/src=/m19-transcript-attack-label/onerror=window.__m19TranscriptLabelXss=1>';

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function scriptSources(html) {
  return Array.from(html.matchAll(/<script\b([^>]*)>/gi)).map(function (match) {
    var source = match[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    return source ? source[1] : '<inline>';
  });
}

function FakeNode(tagName, ownerDocument, nodeType) {
  this.tagName = tagName ? String(tagName).toUpperCase() : '';
  this.ownerDocument = ownerDocument;
  this.nodeType = nodeType || 1;
  this.parentNode = null;
  this.children = [];
  this.attributes = Object.create(null);
  this.className = '';
  this.style = {};
  this.scrollTop = 0;
  this.scrollHeight = 240;
  this._text = '';
}

FakeNode.prototype.appendChild = function (child) {
  child.parentNode = this;
  this.children.push(child);
  return child;
};

FakeNode.prototype.replaceChildren = function () {
  this.children.forEach(function (child) { child.parentNode = null; });
  this.children = [];
  this._text = '';
  for (var index = 0; index < arguments.length; index += 1) this.appendChild(arguments[index]);
};

FakeNode.prototype.setAttribute = function (name, value) {
  this.attributes[String(name)] = String(value);
};

FakeNode.prototype.getAttribute = function (name) {
  return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
};

Object.defineProperty(FakeNode.prototype, 'textContent', {
  get: function () {
    return this._text + this.children.map(function (child) { return child.textContent; }).join('');
  },
  set: function (value) {
    this._text = value == null ? '' : String(value);
    this.children = [];
  },
});

function createDocument() {
  var document = {};
  document.createElement = function (tagName) { return new FakeNode(tagName, document, 1); };
  document.createTextNode = function (value) {
    var node = new FakeNode('', document, 3);
    node.textContent = value;
    return node;
  };
  return document;
}

function loadRenderer() {
  var source = fs.existsSync(RENDERER_PATH) ? read(RENDERER_PATH) : '';
  var document = createDocument();
  var window = { document: document };
  window.window = window;
  var sandbox = { window: window, document: document, Object: Object, Array: Array, String: String };
  vm.createContext(sandbox);
  if (source) vm.runInContext(source, sandbox, { filename: 'transcript-renderer.js' });
  return { document: document, renderer: window.NorthStarTranscriptRenderer, source: source };
}

function bubbleSnapshot(container) {
  return container.children.map(function (bubble) {
    var label = bubble.children.find(function (child) { return child.className === 'demo-msg-label'; });
    return {
      className: bubble.className,
      label: label ? label.textContent : '',
      text: bubble.textContent.slice(label ? label.textContent.length : 0),
    };
  });
}

describe('Mission 19 shared transcript rendering safety', () => {
  test('one browser facade owns DOM construction without HTML parsing', () => {
    const loaded = loadRenderer();
    expect(loaded.source).not.toBe('');
    expect(loaded.renderer).toBeDefined();
    expect(typeof loaded.renderer.render).toBe('function');
    expect(typeof loaded.renderer.normalizeSpeaker).toBe('function');
    expect(loaded.source).toMatch(/createElement/);
    expect(loaded.source).toMatch(/createTextNode|textContent/);
    expect(loaded.source).toMatch(/replaceChildren/);
    expect(loaded.source).not.toMatch(/\.innerHTML\s*=/);
    expect(loaded.source).not.toMatch(/insertAdjacentHTML|DOMParser|createContextualFragment/);
  });

  test('structured, JSON, legacy, labels, unknown speakers, and scroll policies stay literal', () => {
    const loaded = loadRenderer();
    expect(loaded.renderer).toBeDefined();
    const container = loaded.document.createElement('div');
    container.scrollTop = 71;
    const structured = [
      { speaker: 'assistant', text: 'Structured ' + IMAGE_PAYLOAD },
      { speaker: 'human', text: CLOSING_PAYLOAD },
      { speaker: 'observer', text: 'Unknown speaker remains system text' },
    ];
    const result = loaded.renderer.render(container, structured, {
      labels: { ai: 'AI AGENT', customer: LABEL_PAYLOAD },
      scroll: 'preserve',
      live: 'polite',
    });
    expect(result).toEqual({ count: 3, format: 'structured' });
    expect(container.scrollTop).toBe(71);
    expect(container.getAttribute('role')).toBe('log');
    expect(container.getAttribute('aria-live')).toBe('polite');
    expect(bubbleSnapshot(container)).toEqual([
      { className: 'demo-msg ai', label: 'AI AGENT', text: 'Structured ' + IMAGE_PAYLOAD },
      { className: 'demo-msg customer', label: LABEL_PAYLOAD, text: CLOSING_PAYLOAD },
      { className: 'demo-msg system', label: '', text: 'Unknown speaker remains system text' },
    ]);

    loaded.renderer.render(container, JSON.stringify(structured), {
      labels: { ai: 'NorthStar AI', customer: 'Customer' },
      scroll: 'bottom',
    });
    expect(container.scrollTop).toBe(240);
    expect(bubbleSnapshot(container)[0]).toEqual({
      className: 'demo-msg ai', label: 'NorthStar AI', text: 'Structured ' + IMAGE_PAYLOAD,
    });

    loaded.renderer.render(container,
      'Agent: Legacy ' + IMAGE_PAYLOAD + '\nCustomer: ' + CLOSING_PAYLOAD + '\nObserver: unchanged', {
        labels: { ai: 'AI AGENT', customer: LABEL_PAYLOAD },
        scroll: 'top',
      });
    expect(container.scrollTop).toBe(0);
    expect(bubbleSnapshot(container)).toEqual([
      { className: 'demo-msg ai', label: 'AI AGENT', text: 'Legacy ' + IMAGE_PAYLOAD },
      { className: 'demo-msg customer', label: LABEL_PAYLOAD, text: CLOSING_PAYLOAD },
      { className: 'demo-msg system', label: '', text: 'Observer: unchanged' },
    ]);
    expect(loaded.renderer.normalizeSpeaker('BOT')).toBe('ai');
    expect(loaded.renderer.normalizeSpeaker('user')).toBe('customer');
    expect(loaded.renderer.normalizeSpeaker('observer')).toBe('system');
  });

  test('empty, malformed, plain, and deterministic replacement states preserve exact wording', () => {
    const loaded = loadRenderer();
    expect(loaded.renderer).toBeDefined();
    const container = loaded.document.createElement('div');
    const messages = {
      missing: 'No transcript available.',
      unrecognized: 'Unrecognized transcript format.',
      parseError: 'Unable to parse transcript.',
      empty: 'No transcript turns found.',
    };
    loaded.renderer.render(container, null, { messages: messages });
    expect(container.textContent).toBe(messages.missing);
    loaded.renderer.render(container, '{bad json', { messages: messages });
    expect(container.textContent).toBe(messages.parseError);
    loaded.renderer.render(container, '{"text":"not turns"}', { messages: messages });
    expect(container.textContent).toBe(messages.unrecognized);
    loaded.renderer.render(container, [], { messages: messages });
    expect(container.textContent).toBe(messages.empty);

    const plain = 'Agent: ' + IMAGE_PAYLOAD + '\nCustomer: ' + CLOSING_PAYLOAD;
    loaded.renderer.render(container, plain, { presentation: 'plain', scroll: 'top' });
    expect(container.children).toHaveLength(1);
    expect(container.children[0].textContent).toBe(plain);
    loaded.renderer.render(container, [{ speaker: 'ai', text: 'replacement' }], { scroll: 'top' });
    expect(container.children).toHaveLength(1);
    expect(container.textContent).toBe('replacement');
    expect(container.textContent).not.toContain(IMAGE_PAYLOAD);
  });

  test('every mounted consumer loads the facade before transcript presentation code', () => {
    CUSTOMER_DETAIL_CONSUMERS.forEach(function (file) {
      const sources = scriptSources(read(file));
      expect(sources.indexOf('/js/transcript-renderer.js')).toBeGreaterThan(-1);
      expect(sources.indexOf('/js/transcript-renderer.js')).toBeLessThan(sources.indexOf('/js/customer-detail.js'));
    });

    const indexSources = scriptSources(read(INDEX_PATH));
    expect(indexSources.indexOf('/js/transcript-renderer.js')).toBeGreaterThan(-1);
    expect(indexSources.indexOf('/js/transcript-renderer.js')).toBeLessThan(indexSources.indexOf('<inline>'));

    const leadSources = scriptSources(read(LEAD_PATH));
    expect(leadSources.indexOf('/js/transcript-renderer.js')).toBeGreaterThan(-1);
    expect(leadSources.indexOf('/js/transcript-renderer.js')).toBeLessThan(leadSources.indexOf('<inline>'));
  });

  test('superseded unsafe transcript helpers and sinks are absent from exact consumers', () => {
    const customerDetail = read(CUSTOMER_DETAIL_PATH);
    const index = read(INDEX_PATH);
    const lead = read(LEAD_PATH);
    expect(customerDetail).not.toMatch(/function\s+renderTranscriptBubbles|function\s+renderLegacyTranscript/);
    expect(customerDetail).not.toMatch(/\$\('cdTranscript'\)\.innerHTML\s*=/);
    expect(customerDetail).toMatch(/NorthStarTranscriptRenderer\.render/);
    expect(index).not.toMatch(/function\s+normalizeSpeaker/);
    expect(index).not.toMatch(/postBody\.innerHTML\s*=\s*liveBody\.innerHTML/);
    expect(index).not.toMatch(/html\s*\+=\s*line\.text/);
    expect(index).toMatch(/NorthStarTranscriptRenderer\.render/);
    expect(lead).not.toMatch(/\+\s*transcript\s*\+/);
    expect(lead).toMatch(/NorthStarTranscriptRenderer\.render/);
  });
});
