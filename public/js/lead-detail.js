/**
 * Lead Detail — authoritative server-first bootstrap.
 *
 * This page never reads AppStore. A server rejection always replaces the
 * loading state with the same non-disclosing not-found presentation.
 */
(function (window, document) {
  'use strict';

  var container = null;

  function valueOf(lead, keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      var value = lead && lead[keys[i]];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
  }

  function formatPrice(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0
      ? '$' + Math.round(number).toLocaleString()
      : '—';
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function appendCard(grid, title, value, secondary) {
    var card = element('div', 'lead-detail-card');
    card.appendChild(element('h3', '', title));
    card.appendChild(element('div', 'value', value));
    if (secondary) card.appendChild(element('div', 'value-secondary', secondary));
    grid.appendChild(card);
  }

  function appendTextSection(title, value, preformatted) {
    if (!value) return;
    var section = element('section', 'lead-detail-section');
    section.appendChild(element('h2', '', title));
    var card = element('div', 'lead-detail-card');
    var content = element(preformatted ? 'pre' : 'div', preformatted ? 'lead-detail-pre' : 'value-secondary', value);
    card.appendChild(content);
    section.appendChild(card);
    container.appendChild(section);
  }

  function renderSafeError() {
    container.replaceChildren();
    var state = element('div', 'lead-detail-state');
    state.id = 'leadSafeError';
    state.dataset.leadState = 'not-found';
    state.appendChild(element('div', 'lead-detail-state-icon', '😕'));
    var message = element('div', '', 'Lead not found. ');
    var link = element('a', '', 'Back to leads');
    link.href = '/dashboard/leads';
    link.style.color = 'var(--brand-600)';
    message.appendChild(link);
    state.appendChild(message);
    container.appendChild(state);
    window.__northstarLeadDetailState = Object.freeze({ status: 'not-found' });
  }

  function renderLead(lead) {
    var id = valueOf(lead, ['id'], '');
    if (!id) return renderSafeError();

    var name = valueOf(lead, ['caller', 'callerName', 'caller_name', 'customerName', 'customer_name'], 'Unknown');
    var service = valueOf(lead, ['service', 'serviceRequested', 'service_type'], '—');
    var phone = valueOf(lead, ['phone', 'phoneNumber', 'caller_phone'], '—');
    var address = valueOf(lead, ['address', 'jobAddress'], '—');
    var status = valueOf(lead, ['status'], 'new');
    var outcome = valueOf(lead, ['outcome', 'callOutcome'], '—');
    var price = formatPrice(valueOf(lead, ['avgPrice', 'estimatedPrice', 'estimated_price'], null));
    var received = formatDate(valueOf(lead, ['receivedAt', 'createdAt', 'created_at'], null));
    var updated = formatDate(valueOf(lead, ['updatedAt', 'updated_at'], null));

    container.replaceChildren();
    var header = element('header', 'lead-detail-header');
    var heading = element('div');
    heading.appendChild(element('div', 'lead-detail-title', name));
    heading.appendChild(element('div', 'lead-detail-subtitle', service + ' · ' + price + ' · ' + phone));
    header.appendChild(heading);

    var actions = element('div', 'lead-actions');
    var back = element('a', 'btn btn-secondary btn-sm', '← Back to Leads');
    back.href = '/dashboard/leads';
    var contact = element('a', 'btn btn-primary btn-sm', 'Contact');
    contact.href = '/dashboard/communications';
    actions.appendChild(back);
    actions.appendChild(contact);
    header.appendChild(actions);
    container.appendChild(header);

    var grid = element('div', 'lead-detail-grid');
    appendCard(grid, 'Status', status);
    appendCard(grid, 'Service', service, valueOf(lead, ['jobDetail', 'job_detail'], ''));
    appendCard(grid, 'Estimated Value', price);
    appendCard(grid, 'Outcome', outcome);
    appendCard(grid, 'Phone', phone);
    appendCard(grid, 'Address', address);
    appendCard(grid, 'Lead ID', id);
    appendCard(grid, 'Received', received);
    appendCard(grid, 'Last Updated', updated);
    container.appendChild(grid);

    appendTextSection('Summary', valueOf(lead, ['summary', 'callSummary'], ''), false);
    appendTextSection('Transcript', valueOf(lead, ['transcript'], ''), true);

    var polarisData = valueOf(lead, ['polarisData', 'polarisEstimate'], null);
    if (polarisData && window.PolarisUI && typeof window.PolarisUI.render === 'function') {
      var polarisSection = element('section', 'lead-detail-section');
      polarisSection.appendChild(element('h2', '', 'POLARIS Intelligence'));
      var polarisContainer = element('div');
      polarisContainer.id = 'polarisContainer';
      polarisSection.appendChild(polarisContainer);
      container.appendChild(polarisSection);
      window.PolarisUI.render(polarisContainer, polarisData, { context: 'lead' });
    }

    container.dataset.leadState = 'ready';
    window.__northstarLeadDetailState = Object.freeze({ status: 'ready', id: String(id) });
  }

  async function bootstrap() {
    container = document.getElementById('leadDetailContainer');
    if (!container) return;

    if (window.NavComponent && typeof window.NavComponent.init === 'function') {
      window.NavComponent.init('leads');
    }

    var leadId = new URL(window.location.href).searchParams.get('id');
    if (!leadId || !window.API || typeof window.API.getLead !== 'function') {
      return renderSafeError();
    }

    try {
      var lead = await window.API.getLead(leadId);
      renderLead(lead);
    } catch (_error) {
      renderSafeError();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})(window, document);
