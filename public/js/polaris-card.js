(function (global) {
  'use strict';

  var CONTRACT = 'northstar_polaris_intelligence_card_v1';
  var DETAILED_SURFACES = Object.freeze(['command-center', 'leads', 'polaris']);

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function safeText(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return '';
  }

  function safeItems(values, fallback) {
    var result = [];
    if (Array.isArray(values)) {
      values.forEach(function (value) {
        var text = safeText(value && typeof value === 'object' ? (value.label || value.text || value.reason) : value);
        if (text && result.indexOf(text) < 0) result.push(text);
      });
    }
    if (!result.length && fallback) result.push(fallback);
    return result;
  }

  function listSection(title, values, fallback) {
    var section = element('section', 'polaris-card-section');
    section.appendChild(element('h4', '', title));
    var list = element('ul', 'polaris-card-list');
    safeItems(values, fallback).forEach(function (text) { list.appendChild(element('li', '', text)); });
    section.appendChild(list);
    return section;
  }

  function recommendationList(values) {
    var section = element('section', 'polaris-card-section polaris-card-recommendations');
    section.appendChild(element('h4', '', 'Prioritized recommendations'));
    var list = element('ol', 'polaris-card-list');
    var entries = Array.isArray(values) ? values : [];
    if (!entries.length) entries = [{ label: 'No recommendation is available until more role-authorized inputs are recorded.' }];
    entries.forEach(function (entry) {
      var label = safeText(entry && typeof entry === 'object' ? entry.label : entry);
      if (!label) return;
      var item = element('li');
      var href = safeText(entry && entry.href);
      if (href && href.charAt(0) === '/') {
        var link = element('a', 'polaris-card-link', label);
        link.href = href;
        item.appendChild(link);
      } else {
        item.textContent = label;
      }
      var priority = safeText(entry && entry.priority);
      if (priority) item.appendChild(element('span', 'polaris-card-priority', priority));
      list.appendChild(item);
    });
    section.appendChild(list);
    return section;
  }

  function objectLinks(values) {
    var entries = Array.isArray(values) ? values : [];
    if (!entries.length) return null;
    var section = element('nav', 'polaris-card-object-links');
    section.setAttribute('aria-label', 'Polaris object detail');
    entries.forEach(function (entry) {
      var label = safeText(entry && entry.label);
      var href = safeText(entry && entry.href);
      if (!label || !href || href.charAt(0) !== '/') return;
      var link = element('a', 'polaris-card-link', label);
      link.href = href;
      section.appendChild(link);
    });
    return section.childNodes.length ? section : null;
  }

  function normalize(input) {
    if (!input || input.contract !== CONTRACT || typeof input.surface !== 'string') {
      throw new Error('The Polaris intelligence card contract is unavailable.');
    }
    var rawConfidence = input.confidence;
    var numericConfidence = rawConfidence === null || rawConfidence === undefined || rawConfidence === '' ||
      typeof rawConfidence === 'boolean' ? null : Number(rawConfidence);
    return {
      surface: input.surface,
      title: safeText(input.title) || 'Polaris intelligence is unavailable',
      summary: safeText(input.summary) || 'No role-authorized summary can be calculated from the current inputs.',
      confidence: Number.isFinite(numericConfidence) ? Math.max(0, Math.min(100, numericConfidence)) : null,
      confidenceExplanation: safeText(input.confidenceExplanation) || 'Confidence is unavailable because supporting inputs are incomplete.',
      evidence: safeItems(input.evidence, 'No supporting evidence is recorded for this projection.'),
      missing: safeItems(input.missing, 'No missing-input explanation was supplied.'),
      risks: safeItems(input.risks, 'No specific risk is supported by the current inputs.'),
      opportunities: safeItems(input.opportunities, 'No specific opportunity is supported by the current inputs.'),
      recommendations: Array.isArray(input.recommendations) ? input.recommendations : [],
      objects: Array.isArray(input.objects) ? input.objects : [],
      detailed: input.detailed === true || DETAILED_SURFACES.indexOf(input.surface) >= 0,
    };
  }

  function render(container, input) {
    if (!container || typeof container.replaceChildren !== 'function') {
      throw new Error('The Polaris intelligence card mount is unavailable.');
    }
    var value = normalize(input);
    container.replaceChildren();
    container.dataset.polarisCard = CONTRACT;
    container.dataset.polarisSurface = value.surface;
    container.classList.add('polaris-intelligence-card');

    var heading = element('div', 'polaris-card-heading');
    heading.appendChild(element('span', 'polaris-card-mark', '✦'));
    var headingCopy = element('div');
    headingCopy.append(element('p', 'polaris-card-kicker', 'Polaris intelligence'), element('h2', '', value.title));
    heading.appendChild(headingCopy);
    container.append(heading, element('p', 'polaris-card-summary', value.summary));

    var confidence = element('div', 'polaris-card-confidence');
    confidence.append(
      element('strong', '', value.confidence === null ? 'Confidence unavailable' : Math.round(value.confidence) + '% confidence'),
      element('span', '', value.confidenceExplanation)
    );
    container.appendChild(confidence);

    var links = objectLinks(value.objects);
    if (links) container.appendChild(links);

    if (value.detailed) {
      var details = element('details', 'polaris-card-details');
      details.appendChild(element('summary', '', 'Evidence, missing inputs, risks, and recommendations'));
      var grid = element('div', 'polaris-card-detail-grid');
      grid.append(
        listSection('Evidence', value.evidence),
        listSection('Missing information', value.missing),
        listSection('Risks', value.risks),
        listSection('Opportunities', value.opportunities),
        recommendationList(value.recommendations)
      );
      details.appendChild(grid);
      container.appendChild(details);
    } else {
      container.appendChild(recommendationList(value.recommendations));
    }

    return value;
  }

  global.NorthStarPolarisCard = Object.freeze({
    CONTRACT: CONTRACT,
    DETAILED_SURFACES: DETAILED_SURFACES,
    render: render,
  });
})(window);
