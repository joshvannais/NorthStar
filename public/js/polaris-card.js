(function (global) {
  'use strict';

  var CONTRACT = 'northstar_polaris_intelligence_card_v1';
  var DETAILED_SURFACES = Object.freeze(['command-center', 'leads', 'polaris', 'communications']);

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

  // Presentation only: read authorized recorded facts, never rewrite their evidence or history.
  var FACTS = Object.freeze({customerDistanceMiles:['Distance','miles'],jobType:['Job Type',''],serviceRadiusMiles:['Service Radius','miles'],serviceZone:['Service Area',''],sqft:['Floor Area','square feet'],squareFeet:['Area','square feet'],linearFeet:['Length','ft'],laborHours:['Labor Time','hours'],estimatedDurationHours:['Estimated Duration','hours'],seer:['SEER',''],tonnage:['HVAC Capacity','tons'],squares:['Roof Area','roofing squares']});
  var GAPS = Object.freeze({vehicleCost:'Vehicle cost needs confirmation for this estimate.',fuelCost:'Fuel cost needs confirmation for this estimate.',callDurationSeconds:'Call duration is not recorded.',travelMinutes:'Travel time needs confirmation.',travelDistanceMiles:'Travel distance needs confirmation.',travelSource:'Confirm how the travel distance and time were determined.',equipmentReference:'Confirm the equipment needed for this job.',knownEquipmentCost:'Equipment cost needs confirmation.',knownDirectMaterialCost:'Material cost needs confirmation.',actualCrewAssignment:'This assessment does not record a crew assignment. Check the current schedule.',appointmentPreference:'Confirm the customer’s preferred appointment time.'});
  function businessText(value) {
    var text=safeText(value);
    return /\b(?:Part\s*\d+|authoritative|input.source|snapshot|projection|role-authorized)\b|\b[a-z]+[A-Z][A-Za-z]*\b|Demo record detail collected|^[\[{]/.test(text)?'':text;
  }
  function describeGraph(graph) {
    var polaris=graph&&graph.polaris||{},snap=polaris.snapshot||{},service=String(graph&&graph.lead&&graph.lead.serviceType||'').toLowerCase();
    var evidence=[],missing=[],unknown=false;
    (Array.isArray(polaris.facts)?polaris.facts:[]).forEach(function(fact){
      if(!fact||typeof fact!=='object')return;
      var spec=FACTS[fact.variable],value=fact.normalizedValue;
      if(!spec){unknown=true;return;}
      if((fact.variable==='seer'||fact.variable==='tonnage')&&service!=='hvac')return;
      if(fact.variable==='squares'&&service!=='roofing')return;
      if(value===null||value===undefined||value===''||typeof value==='object'){missing.push(spec[0]+' needs confirmation.');return;}
      if(spec[1]&&(typeof value!=='number'||!Number.isFinite(value))){missing.push(spec[0]+' needs confirmation.');return;}
      var text=businessText(value);if(!text){missing.push(spec[0]+' needs confirmation.');return;}
      evidence.push(spec[0]+': '+text+(spec[1]?' '+spec[1]:'')+(fact.status==='conflicting'?' — Needs confirmation':''));
    });
    if(unknown)missing.push('Additional job details need review in the customer record.');
    (Array.isArray(snap.missingInformation)?snap.missingInformation:[]).forEach(function(entry){var text=businessText(entry&&typeof entry==='object'?(entry.reason||entry.label):entry);missing.push(text||'Review the missing job details before finalizing the estimate.');});
    (Array.isArray(snap.notCalculated)?snap.notCalculated:[]).forEach(function(entry){if(!entry)return;missing.push(GAPS[entry.field]||businessText(entry.reason)||'Some estimate amounts are unavailable. Review the cost details.');});
    return {evidence:safeItems(evidence,'No readable job facts are recorded for this assessment.'),missing:safeItems(missing,'No additional details are flagged by this assessment.')};
  }

  function listSection(title, values, fallback) {
    var section = element('section', 'polaris-card-section');
    section.appendChild(element('h3', '', title));
    var list = element('ul', 'polaris-card-list');
    safeItems(values, fallback).forEach(function (text) { list.appendChild(element('li', '', text)); });
    section.appendChild(list);
    return section;
  }

  function recommendationList(values) {
    var section = element('section', 'polaris-card-section polaris-card-recommendations');
    section.appendChild(element('h3', '', 'Prioritized recommendations'));
    var list = element('ol', 'polaris-card-list');
    var entries = Array.isArray(values) ? values : [];
    if (!entries.length) entries = [{ label: 'No recommendation is available yet. More accessible supporting information is needed.' }];
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
    section.setAttribute('aria-label', 'Open complete Polaris intelligence');
    var primary = entries.find(function (entry) {
      return /lead detail/i.test(safeText(entry && entry.label)) && safeText(entry && entry.href).charAt(0) === '/';
    }) || entries.find(function (entry) {
      return safeText(entry && entry.href).charAt(0) === '/';
    });
    if (primary) {
      var link = element('a', 'polaris-card-link polaris-card-primary-action', 'Explore Complete Intelligence');
      link.href = safeText(primary.href);
      section.appendChild(link);
    }
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
      summary: safeText(input.summary) || 'A summary is unavailable from the information you can access.',
      confidence: Number.isFinite(numericConfidence) ? Math.max(0, Math.min(100, numericConfidence)) : null,
      confidenceExplanation: safeText(input.confidenceExplanation) || 'Confidence is unavailable because supporting inputs are incomplete.',
      evidence: safeItems(Array.isArray(input.evidence)?input.evidence.map(businessText):[], 'No readable job facts are recorded for this assessment.'),
      missing: safeItems(Array.isArray(input.missing)?input.missing.map(businessText):[], 'Review the job details before finalizing the estimate.'),
      risks: safeItems(Array.isArray(input.risks) ? input.risks.map(businessText) : [], 'No specific risks identified from available details.'),
      opportunities: safeItems(input.opportunities),
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
    heading.append(headingCopy, element('span', 'polaris-card-status', value.surface === 'command-center' ? 'Current' : 'Recorded'));
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
      details.appendChild(element('summary', '', 'Job Details And Next Steps'));
      var grid = element('div', 'polaris-card-detail-grid');
      grid.append(
        listSection('Evidence', value.evidence),
        listSection('To Confirm', value.missing),
        listSection('Risks', value.risks),
        recommendationList(value.recommendations)
      );
      if(value.opportunities.length)grid.appendChild(listSection('Opportunities',value.opportunities));
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
    describeGraph: describeGraph,
    render: render,
  });
})(window);
