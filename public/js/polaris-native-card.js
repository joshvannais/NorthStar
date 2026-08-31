(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorthStarPolarisCard = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CARD_SCHEMA = 'northstar.polaris.customer-intelligence-card.v1';
  var renderSequence = 0;

  function text(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback || '';
    var projected = typeof value === 'string' ? value : String(value);
    return projected.length > 500 ? projected.slice(0, 499) + '…' : projected;
  }

  function child(tag, className, value) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = text(value);
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
    if (!card || card.schemaVersion !== CARD_SCHEMA || card.kind !== 'customer_intelligence' ||
        card.tone !== 'purple' || card.advisoryOnly !== true ||
        card.canonicalMutationAllowed !== false || !Array.isArray(card.evidence) ||
        !Array.isArray(card.unknowns) || !card.confidence) {
      throw new Error('Unsupported Polaris customer-intelligence card.');
    }
    return card;
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
    buildDemoCard: buildDemoCard,
    renderCustomerIntelligenceCard: renderCustomerIntelligenceCard
  };
});
