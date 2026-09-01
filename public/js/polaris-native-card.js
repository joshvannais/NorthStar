(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorthStarPolarisCard = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CARD_SCHEMA = 'northstar.polaris.customer-intelligence-card.v1';
  var RESPONSE_SCHEMA = 'northstar.polaris.assistant-response.v1';
  var STATUS_SCHEMA = 'northstar.polaris.assistant-status.v1';
  var PROVIDER_DECISIONS = [
    'credential_source', 'current_official_documentation_review', 'model', 'budget_and_rate',
    'timeout_and_retry', 'retention_and_logging', 'user_facing_failure_policy'
  ];
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var DIGEST = /^[0-9a-f]{64}$/i;
  var UNKNOWN_CODE = /^[a-z0-9_]{1,100}$/;
  var renderSequence = 0;

  function invalidContract() {
    throw new Error('Unsupported Polaris structured contract.');
  }

  function exactObject(value, expected) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      return invalidContract();
    }
    var keys = Reflect.ownKeys(value);
    if (keys.some(function (key) { return typeof key !== 'string'; })) return invalidContract();
    keys.sort();
    expected = expected.slice().sort();
    if (keys.length !== expected.length || keys.some(function (key, index) { return key !== expected[index]; })) {
      return invalidContract();
    }
    if (keys.some(function (key) {
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true;
    })) return invalidContract();
    return value;
  }

  function exactArray(value, maximum) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
      return invalidContract();
    }
    var keys = Reflect.ownKeys(value);
    var expected = ['length'];
    for (var index = 0; index < value.length; index += 1) expected.push(String(index));
    if (keys.some(function (key) { return typeof key !== 'string'; }) || keys.length !== expected.length ||
        expected.some(function (key) { return keys.indexOf(key) < 0; }) || expected.slice(1).some(function (key) {
          var descriptor = Object.getOwnPropertyDescriptor(value, key);
          return !descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true;
        })) return invalidContract();
    return value;
  }

  function boundedString(value, minimum, maximum) {
    return typeof value === 'string' && value.length >= minimum && value.length <= maximum && !/\u0000/.test(value);
  }

  function selection(value) {
    var selected = exactObject(value, ['id', 'kind']);
    if (['customer', 'lead', 'work'].indexOf(selected.kind) < 0 || !boundedString(selected.id, 36, 36) || !UUID.test(selected.id)) {
      return invalidContract();
    }
    return selected;
  }

  function sameSelection(left, right) {
    if (!left || !right) return left === right;
    return left.kind === right.kind && left.id === right.id;
  }

  function validateEvidence(value) {
    var entry = exactObject(value, ['confidence', 'id', 'label', 'source', 'untrustedText', 'value']);
    var source = exactObject(entry.source, ['id', 'kind']);
    if (!boundedString(entry.id, 1, 128) || !boundedString(entry.label, 1, 100) ||
        !boundedString(entry.value, 1, 2000) ||
        !(entry.confidence === null || (typeof entry.confidence === 'number' && Number.isFinite(entry.confidence) &&
          entry.confidence >= 0 && entry.confidence <= 1)) || entry.untrustedText !== true ||
        ['canonical_fact', 'deterministic_demo'].indexOf(source.kind) < 0 || !boundedString(source.id, 1, 128)) {
      return invalidContract();
    }
    return entry;
  }

  function validateUnknown(value) {
    var entry = exactObject(value, ['code', 'label']);
    if (typeof entry.code !== 'string' || !UNKNOWN_CODE.test(entry.code) || !boundedString(entry.label, 1, 500)) {
      return invalidContract();
    }
    return entry;
  }

  function validateConfidence(value) {
    var confidence = exactObject(value, ['basis', 'level', 'value']);
    if (!(confidence.value === null || (typeof confidence.value === 'number' && Number.isFinite(confidence.value) &&
        confidence.value >= 0 && confidence.value <= 1)) ||
        ['unknown', 'low', 'medium', 'high'].indexOf(confidence.level) < 0 ||
        !boundedString(confidence.basis, 1, 500) || (confidence.value === null && confidence.level !== 'unknown')) {
      return invalidContract();
    }
    return confidence;
  }

  function validateCardAuthority(value, expectedSelected) {
    var authority;
    if (value && Object.prototype.hasOwnProperty.call(value, 'source')) {
      authority = exactObject(value, ['selected', 'source']);
      if (authority.source !== 'deterministic_demo_session') return invalidContract();
    } else {
      authority = exactObject(value, [
        'calculationVersion', 'graphId', 'projectionDigest', 'readModelVersion', 'selected',
        'snapshotDigest', 'snapshotId'
      ]);
      if (!UUID.test(authority.graphId || '') || !UUID.test(authority.snapshotId || '') ||
          !DIGEST.test(authority.snapshotDigest || '') || !DIGEST.test(authority.projectionDigest || '') ||
          !boundedString(authority.calculationVersion, 1, 128) || !boundedString(authority.readModelVersion, 1, 128)) {
        return invalidContract();
      }
    }
    var selected = selection(authority.selected);
    if (expectedSelected && !sameSelection(selected, expectedSelected)) return invalidContract();
    return authority;
  }

  function validateCustomerIntelligenceCard(value, expectedSelected) {
    var card = exactObject(value, [
      'advisoryOnly', 'answer', 'authority', 'canonicalMutationAllowed', 'confidence', 'evidence',
      'kind', 'schemaVersion', 'subtitle', 'title', 'tone', 'unknowns'
    ]);
    if (card.schemaVersion !== CARD_SCHEMA || card.kind !== 'customer_intelligence' || card.tone !== 'purple' ||
        !boundedString(card.title, 1, 200) || !boundedString(card.subtitle, 1, 200) ||
        !boundedString(card.answer, 1, 2000) || card.advisoryOnly !== true || card.canonicalMutationAllowed !== false) {
      return invalidContract();
    }
    exactArray(card.evidence, 12).forEach(validateEvidence);
    exactArray(card.unknowns, 12).forEach(validateUnknown);
    validateConfidence(card.confidence);
    validateCardAuthority(card.authority, expectedSelected || null);
    return card;
  }

  function validateAssistantResponse(value, expected) {
    expected = expected || {};
    var response = exactObject(value, [
      'advisoryOnly', 'answer', 'authority', 'canonicalMutationAllowed', 'cards', 'provider',
      'requestId', 'responseId', 'schemaVersion', 'selected', 'source', 'state'
    ]);
    var authority = exactObject(response.authority, ['organizationId', 'role', 'userId']);
    var selected = response.selected === null ? null : selection(response.selected);
    var answer = exactObject(response.answer, ['evidenceCount', 'text', 'unknownCount']);
    var provider = exactObject(response.provider, ['requestsSent', 'state']);
    var cards = exactArray(response.cards, 4);
    if (response.schemaVersion !== RESPONSE_SCHEMA || !boundedString(response.requestId, 1, 128) ||
        !boundedString(response.responseId, 1, 128) || response.state !== 'available' ||
        ['canonical_local', 'interceptor', 'openai'].indexOf(response.source) < 0 ||
        !UUID.test(authority.organizationId || '') || !UUID.test(authority.userId || '') || !boundedString(authority.role, 1, 64) ||
        !boundedString(answer.text, 1, 8000) || !Number.isSafeInteger(answer.evidenceCount) ||
        answer.evidenceCount < 0 || answer.evidenceCount > 48 || !Number.isSafeInteger(answer.unknownCount) ||
        answer.unknownCount < 0 || answer.unknownCount > 48 ||
        (response.source === 'openai'
          ? provider.state !== 'configured' || [1, 2].indexOf(provider.requestsSent) < 0
          : provider.state !== 'unconfigured' || provider.requestsSent !== 0) ||
        response.advisoryOnly !== true || response.canonicalMutationAllowed !== false ||
        (!selected && cards.length) || (expected.requestId && response.requestId !== expected.requestId) ||
        (expected.source && response.source !== expected.source) ||
        (Object.prototype.hasOwnProperty.call(expected, 'selected') && !sameSelection(selected, expected.selected))) {
      return invalidContract();
    }
    cards.forEach(function (card) { validateCustomerIntelligenceCard(card, selected); });
    if (answer.evidenceCount !== cards.reduce(function (sum, card) { return sum + card.evidence.length; }, 0) ||
        answer.unknownCount !== cards.reduce(function (sum, card) { return sum + card.unknowns.length; }, 0)) {
      return invalidContract();
    }
    return response;
  }

  function validateAssistantStatus(value) {
    var hasIntercepted = value && Object.prototype.hasOwnProperty.call(value, 'intercepted');
    var keys = ['decisionsRequired', 'label', 'localCustomerIntelligence', 'providerRequestsEnabled',
      'providerRequestsSent', 'requestId', 'schemaVersion', 'state'];
    if (hasIntercepted) keys.push('intercepted');
    var status = exactObject(value, keys);
    var decisions = exactArray(status.decisionsRequired, PROVIDER_DECISIONS.length);
    if (status.schemaVersion !== STATUS_SCHEMA || !boundedString(status.requestId, 1, 128) ||
        ['local', 'unconfigured', 'error', 'available', 'configured'].indexOf(status.state) < 0 ||
        !boundedString(status.label, 1, 160) || status.localCustomerIntelligence !== 'available' ||
        typeof status.providerRequestsEnabled !== 'boolean' || status.providerRequestsSent !== 0 ||
        (status.providerRequestsEnabled
          ? status.state !== 'configured' || decisions.length !== 0
          : decisions.length !== PROVIDER_DECISIONS.length || decisions.some(function (entry, index) {
            return entry !== PROVIDER_DECISIONS[index];
          })) || (hasIntercepted && status.intercepted !== true)) {
      return invalidContract();
    }
    return status;
  }

  function text(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback || '';
    var projected = typeof value === 'string' ? value : String(value);
    return projected.length > 500 ? projected.slice(0, 499) + '…' : projected;
  }

  function renderedText(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback || '';
    return typeof value === 'string' ? value : String(value);
  }

  function child(tag, className, value) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = renderedText(value);
    return element;
  }

  function section(title, id) {
    var wrapper = child('section', 'polaris-native-card-section');
    var heading = child('h3', 'polaris-native-card-heading', title);
    heading.id = id;
    wrapper.setAttribute('aria-labelledby', id);
    wrapper.appendChild(heading);
    return wrapper;
  }

  function assertCard(card) {
    return validateCustomerIntelligenceCard(card);
  }

  function renderCustomerIntelligenceCard(container, rawCard) {
    var card = assertCard(rawCard);
    var article = child('article', 'polaris-native-card');
    article.setAttribute('data-schema-version', CARD_SCHEMA);
    article.setAttribute('data-tone', 'purple');
    article.setAttribute('aria-label', 'Customer intelligence for ' + text(card.title, 'selected record'));

    var header = child('header', 'polaris-native-card-header');
    header.appendChild(child('div', 'polaris-native-card-kicker', 'Customer intelligence'));
    header.appendChild(child('h2', 'polaris-native-card-title', card.title || 'Selected record'));
    header.appendChild(child('p', 'polaris-native-card-subtitle', card.subtitle || 'Service type unknown'));
    article.appendChild(header);

    var identity = String(++renderSequence);
    var answer = section('Answer', 'polaris-answer-' + identity);
    answer.appendChild(child('p', 'polaris-native-card-answer', card.answer || 'No answer is recorded.'));
    article.appendChild(answer);

    var evidence = section('Evidence', 'polaris-evidence-' + identity);
    if (card.evidence.length) {
      var evidenceList = child('ul', 'polaris-native-card-list');
      card.evidence.forEach(function (entry) {
        var item = child('li', 'polaris-native-card-evidence');
        item.appendChild(child('span', 'polaris-native-card-label', entry.label || 'Recorded fact'));
        item.appendChild(child('span', 'polaris-native-card-value', entry.value || 'Recorded without displayable detail.'));
        evidenceList.appendChild(item);
      });
      evidence.appendChild(evidenceList);
    } else {
      evidence.appendChild(child('p', 'polaris-native-card-empty', 'No displayable canonical evidence is recorded.'));
    }
    article.appendChild(evidence);

    var unknowns = section('Unknowns', 'polaris-unknowns-' + identity);
    if (card.unknowns.length) {
      var unknownList = child('ul', 'polaris-native-card-list');
      card.unknowns.forEach(function (entry) {
        unknownList.appendChild(child('li', 'polaris-native-card-unknown', entry.label || entry));
      });
      unknowns.appendChild(unknownList);
    } else {
      unknowns.appendChild(child('p', 'polaris-native-card-empty', 'No contract-defined unknowns were identified.'));
    }
    article.appendChild(unknowns);

    var confidence = section('Confidence', 'polaris-confidence-' + identity);
    var confidenceText = card.confidence.value === null || card.confidence.value === undefined
      ? 'Unknown' : Math.round(Number(card.confidence.value) * 100) + '% — ' + text(card.confidence.level, 'unknown');
    confidence.appendChild(child('p', 'polaris-native-card-confidence', confidenceText));
    confidence.appendChild(child('p', 'polaris-native-card-basis', card.confidence.basis || 'No confidence basis is recorded.'));
    article.appendChild(confidence);

    var footer = child('footer', 'polaris-native-card-footer');
    footer.appendChild(child('span', '', 'Advisory and read-only'));
    footer.appendChild(child('span', '', 'No canonical mutation'));
    article.appendChild(footer);

    container.replaceChildren(article);
    return article;
  }

  function renderCustomerIntelligenceCards(container, rawCards) {
    var cards = exactArray(rawCards, 4);
    if (!cards.length) return invalidContract();
    cards.forEach(function (card) { validateCustomerIntelligenceCard(card); });
    var stack = child('section', 'polaris-native-card-stack');
    stack.setAttribute('aria-label', cards.length === 1
      ? 'Customer intelligence card' : cards.length + ' customer intelligence cards');
    cards.forEach(function (card, index) {
      var slot = child('div', 'polaris-native-card-item');
      slot.setAttribute('data-card-position', String(index + 1));
      renderCustomerIntelligenceCard(slot, card);
      stack.appendChild(slot);
    });
    container.replaceChildren(stack);
    return stack;
  }

  function demoEvidence(graph) {
    var entries = [];
    function add(id, label, value) {
      if (value === null || value === undefined || value === '') return;
      entries.push({ id: id, label: label, value: text(value), confidence: null,
        source: { kind: 'deterministic_demo', id: id }, untrustedText: true });
    }
    add('demo-customer', 'Customer', graph.customer && graph.customer.name);
    add('demo-service', 'Service', graph.lead && (graph.lead.serviceLabel || graph.lead.serviceType));
    add('demo-scope', 'Work scope', graph.lead && (graph.lead.summary || graph.lead.scope));
    add('demo-estimate', 'Customer price', graph.estimate && graph.estimate.customerPrice);
    add('demo-schedule', 'Scheduled start', graph.work && graph.work.scheduledStart);
    return entries;
  }

  function buildDemoCard(graph, selection) {
    if (!graph || !selection) throw new Error('An exact demo selection is required.');
    var service = text(graph.lead && (graph.lead.serviceLabel || graph.lead.serviceType), 'Service type unknown');
    var scope = text(graph.lead && (graph.lead.summary || graph.lead.scope), '');
    var unknowns = [];
    if (!scope) unknowns.push({ code: 'work_scope_missing', label: 'Work scope is not recorded.' });
    if (!graph.estimate || graph.estimate.customerPrice === null || graph.estimate.customerPrice === undefined) {
      unknowns.push({ code: 'customer_price_missing', label: 'Customer-facing estimate is not recorded.' });
    }
    if (!graph.work || !graph.work.scheduledStart) unknowns.push({ code: 'schedule_missing', label: 'A scheduled start is not recorded.' });
    return {
      schemaVersion: CARD_SCHEMA,
      kind: 'customer_intelligence',
      tone: 'purple',
      title: text(graph.customer && graph.customer.name, 'Customer'),
      subtitle: service,
      answer: scope || (service === 'Service type unknown'
        ? 'The selected demo record is available, but service and work-scope details are unknown.'
        : service + ' is recorded, but the work scope is unknown.'),
      evidence: demoEvidence(graph),
      unknowns: unknowns,
      confidence: { value: null, level: 'unknown', basis: 'Deterministic demo projections do not invent confidence.' },
      authority: { selected: { kind: selection.kind, id: selection.identifier }, source: 'deterministic_demo_session' },
      advisoryOnly: true,
      canonicalMutationAllowed: false
    };
  }

  return {
    CARD_SCHEMA: CARD_SCHEMA,
    RESPONSE_SCHEMA: RESPONSE_SCHEMA,
    STATUS_SCHEMA: STATUS_SCHEMA,
    buildDemoCard: buildDemoCard,
    renderCustomerIntelligenceCard: renderCustomerIntelligenceCard,
    renderCustomerIntelligenceCards: renderCustomerIntelligenceCards,
    validateAssistantResponse: validateAssistantResponse,
    validateAssistantStatus: validateAssistantStatus,
    validateCustomerIntelligenceCard: validateCustomerIntelligenceCard
  };
});
