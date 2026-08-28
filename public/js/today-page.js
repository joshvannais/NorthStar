(function(root) {
  'use strict';

  var endpoint = '/api/v1/today';
  var requestController = null;

  function byId(id) { return document.getElementById(id); }
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function append(parent) {
    for (var index = 1; index < arguments.length; index += 1) {
      if (arguments[index]) parent.appendChild(arguments[index]);
    }
    return parent;
  }
  function cleanText(value, fallback) {
    return typeof value === 'string' && value ? value : fallback;
  }
  function markupLike(value) {
    if (typeof value !== 'string') return false;
    return /<\s*\/?\s*[a-z][^>]*>/i.test(value) ||
      /&lt;\s*\/?\s*[a-z][\s\S]*?&gt;/i.test(value) ||
      /(?:^|[\s"'])on[a-z]+\s*=\s*/i.test(value) ||
      /(?:javascript\s*:|data\s*:\s*text\/html)/i.test(value);
  }
  function presentationText(value, fallback) {
    var text = cleanText(value, fallback);
    return markupLike(text) ? fallback : text;
  }
  function formatInstant(value, timeZone, options) {
    var instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) return 'Time unavailable';
    try {
      return new Intl.DateTimeFormat(undefined, Object.assign({ timeZone: timeZone }, options)).format(instant);
    } catch (_error) {
      return 'Time unavailable';
    }
  }
  function label(value) {
    return presentationText(value, 'Unavailable').replace(/[_-]+/g, ' ').replace(/\b\w/g, function(letter) {
      return letter.toUpperCase();
    });
  }
  function validate(data) {
    if (!data || data.version !== 'm22-part6-today-v1' || data.readOnly !== true ||
        !Array.isArray(data.mutationCapabilities) || data.mutationCapabilities.length !== 0 ||
        !data.day || typeof data.day.timeZone !== 'string' || !Array.isArray(data.records) ||
        data.count !== data.records.length || data.shown !== data.records.length || data.truncated !== false ||
        typeof data.digest !== 'string' || !/^[0-9a-f]{64}$/.test(data.digest)) {
      throw new Error('TODAY_CONTRACT_INVALID');
    }
    data.records.forEach(function(record) {
      if (!record || typeof record.appointmentId !== 'string' || !record.schedule || !record.assignment ||
          !record.dispatch || !record.route || record.route.providerNeutral !== true || record.route.providerCalls !== 0 ||
          !record.authority || !Number.isSafeInteger(record.authority.revision) ||
          typeof record.authority.digest !== 'string' || !/^[0-9a-f]{64}$/.test(record.authority.digest)) {
        throw new Error('TODAY_RECORD_INVALID');
      }
    });
    return data;
  }
  function setState(name, title, copy, action) {
    document.body.setAttribute('data-today-state', name);
    if (name !== 'ready') {
      byId('todayRecords').replaceChildren();
      byId('todayCount').textContent = name === 'loading' ? 'Checking Today…' : 'No Work Shown';
    }
    byId('todayLoading').hidden = name !== 'loading';
    byId('todayWork').hidden = name !== 'ready';
    var panel = byId('todayStatePanel');
    panel.hidden = !['empty', 'error', 'offline', 'restricted', 'stale'].includes(name);
    if (!panel.hidden) {
      byId('todayStateTitle').textContent = title;
      byId('todayStateCopy').textContent = copy;
      byId('todayStateAction').hidden = action === false;
    }
    byId('todayRefresh').hidden = !panel.hidden && action !== false;
    byId('todayStatus').classList.toggle('sr-only', !panel.hidden);
    byId('todayStatus').textContent = copy;
  }
  function badge(text, state) {
    var node = element('span', 'today-state-badge', text);
    if (state) node.setAttribute('data-state', state);
    return node;
  }
  function detail(labelText, value, subtext) {
    var node = element('div', 'today-detail');
    append(node, element('p', 'today-detail-label', labelText), element('p', 'today-detail-value', value));
    if (subtext) node.appendChild(element('p', 'today-detail-sub', subtext));
    return node;
  }
  function disclosure(title) {
    var node = element('details', 'today-disclosure');
    node.appendChild(element('summary', '', title));
    var content = element('div', 'today-disclosure-content');
    node.appendChild(content);
    return { node: node, content: content };
  }
  function serviceLocation(location) {
    if (!location || typeof location !== 'object') return 'Service location unavailable';
    var fields = ['street', 'line2', 'city', 'state', 'postalCode', 'country']
      .map(function(key) { return cleanText(location[key], ''); }).filter(Boolean);
    if (fields.some(markupLike)) return 'Service location unavailable';
    return fields.join(', ') || 'Service location unavailable';
  }
  function scheduleText(record, timeZone) {
    var start = formatInstant(record.schedule.start, timeZone, { hour: 'numeric', minute: '2-digit' });
    var end = formatInstant(record.schedule.end, timeZone, { hour: 'numeric', minute: '2-digit' });
    return start + '–' + end;
  }
  function renderRecord(record, timeZone) {
    var item = element('li', 'today-work-card');
    item.setAttribute('data-appointment-id', record.appointmentId);
    var accent = element('div', 'today-card-accent');
    accent.setAttribute('aria-hidden', 'true');
    var body = element('article', 'today-card-body');
    body.setAttribute('aria-labelledby', 'today-job-' + record.appointmentId);
    var heading = element('div', 'today-card-heading');
    var title = element('div');
    var jobTitle = element('h3', '', presentationText(record.title, 'Job title unavailable'));
    jobTitle.id = 'today-job-' + record.appointmentId;
    append(title, jobTitle, element('p', 'today-card-service', presentationText(record.serviceType, 'Service type unavailable')));
    var badges = element('div', 'today-badges', null);
    append(badges,
      badge(record.assignment.direct ? 'Assigned to you' : 'Current crew', record.assignment.direct ? 'direct' : 'crew'),
      badge(label(record.schedule.state), record.schedule.state),
      badge(label(record.dispatch.state), record.dispatch.state),
      record.review && record.review.needsReview ? badge('Needs review', 'needs_review') : null
    );
    append(heading, title, badges);
    var grid = element('div', 'today-detail-grid');
    append(grid,
      detail('Schedule', scheduleText(record, timeZone), record.schedule.spansDayBoundary ? 'Continues across a calendar day' : timeZone),
      detail('Assignment', presentationText(record.assignment.label, record.assignment.direct ? 'Employee name unavailable' : 'Crew name unavailable'), record.assignment.direct ? 'Direct assignment' : 'Current active crew'),
      detail('Customer', presentationText(record.customer && record.customer.name, 'Customer name unavailable'), presentationText(record.customer && record.customer.phone, 'Phone unavailable')),
      detail('Service location', serviceLocation(record.customer && record.customer.serviceLocation), 'Use the current job location shown here')
    );
    var instructions = disclosure('Operational instructions');
    instructions.content.appendChild(element('p', '', presentationText(record.instructions && record.instructions.text,
      'Operational instructions unavailable')));
    if (record.instructions && record.instructions.truncated) instructions.content.appendChild(element('p', '', 'Instructions were safely limited for this mobile view.'));
    var route = disclosure('Route and travel evidence');
    route.content.appendChild(element('p', '', 'Status: ' + label(record.route.status) + '.'));
    (Array.isArray(record.route.implications) ? record.route.implications : []).forEach(function(value) {
      route.content.appendChild(element('p', '', presentationText(value, 'Route detail unavailable')));
    });
    (Array.isArray(record.route.uncertainty) ? record.route.uncertainty : []).forEach(function(value) {
      route.content.appendChild(element('p', '', presentationText(value, 'Route detail unavailable')));
    });
    if (record.crew) {
      var crew = disclosure('Current crew context');
      crew.content.appendChild(element('p', '', presentationText(record.crew.name, 'Crew name unavailable')));
      var list = element('ul', 'today-team-list');
      (Array.isArray(record.crew.teammates) ? record.crew.teammates : []).forEach(function(member) {
        list.appendChild(element('li', '', presentationText(member.name, 'Employee name unavailable') + (member.self ? ' (you)' : '') + ' — ' + label(member.role)));
      });
      crew.content.appendChild(list);
      if (record.crew.truncated) crew.content.appendChild(element('p', '', record.crew.shown + ' of ' + record.crew.total + ' current teammates shown.'));
      append(body, heading, grid, instructions.node, route.node, crew.node);
    } else {
      append(body, heading, grid, instructions.node, route.node);
    }
    append(item, accent, body);
    return item;
  }
  function render(data) {
    var timeZone = data.day.timeZone;
    var authority = byId('todayAuthority');
    var identity = presentationText(data.identity && data.identity.displayName, 'Employee name unavailable');
    var role = label(data.identity && data.identity.operationalRole);
    var authorityText = role === 'Owner Operator' ? 'Owner Operator · Personal Work Only' : identity + ' · Personal Work Only';
    authority.textContent = authorityText;
    authority.title = authorityText;
    authority.setAttribute('aria-label', authorityText);
    byId('todayDate').textContent = formatInstant(data.day.start, timeZone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ' · ' + timeZone;
    byId('todayCount').textContent = data.records.length + (data.records.length === 1 ? ' Appointment' : ' Appointments');
    var records = byId('todayRecords');
    records.replaceChildren();
    data.records.forEach(function(record) { records.appendChild(renderRecord(record, timeZone)); });
    if (data.records.length === 0) {
      setState('empty', 'No work assigned for today', 'No direct or current-crew appointments are assigned to you for this tenant day.', false);
    } else {
      setState('ready', '', 'Showing current read-only schedule, dispatch, route, and job essentials.');
    }
  }
  async function load() {
    if (requestController) requestController.abort();
    requestController = new AbortController();
    var timeout = setTimeout(function() { requestController.abort(); }, 12000);
    byId('todayRefresh').disabled = true;
    setState('loading', '', 'Loading your current work…');
    try {
      var response = await fetch(endpoint, { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: requestController.signal });
      var payload = await response.json().catch(function() { return null; });
      if (!response.ok) {
        var code = payload && payload.error && payload.error.code;
        if (response.status === 401 || response.status === 403) {
          setState('restricted', 'Today access changed', 'Your current session, membership, or workforce access no longer permits this view. Sign in again or contact an administrator.', true);
        } else if (response.status === 409 || code === 'M22_TODAY_STALE_RETRY') {
          setState('stale', 'Today changed', 'An assignment or access record changed while Today was loading. Reload for the current view.', true);
        } else {
          setState('error', 'Today is unavailable', 'NorthStar could not load your current work. Reload to try again.', true);
        }
        return;
      }
      render(validate(payload && payload.data));
    } catch (error) {
      var offline = root.navigator && root.navigator.onLine === false;
      setState(offline ? 'offline' : 'error', offline ? 'You appear to be offline' : 'Today is unavailable',
        offline ? 'Reconnect, then reload your current work.' : 'NorthStar could not load your current work. Reload to try again.', true);
    } finally {
      clearTimeout(timeout);
      byId('todayRefresh').disabled = false;
    }
  }

  byId('todayRefresh').addEventListener('click', load);
  byId('todayStateAction').addEventListener('click', load);
  root.addEventListener('online', function() {
    if (document.body.getAttribute('data-today-state') === 'offline') load();
  });
  load();
})(window);
