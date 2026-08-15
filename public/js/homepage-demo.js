(function (global) {
  'use strict';

  var CONNECTION_TIMEOUT_MS = 10000;
  var SCENARIOS = Object.freeze({
    'emergency': Object.freeze({
      label: 'Emergency',
      context: 'A homeowner reports an urgent leak near an electrical panel.',
      intent: 'Urgent service request',
      qualification: 'Safety, location, and urgency context captured',
      summary: 'The guided call prioritizes immediate safety, confirms the service context, and leaves the consequential response to an authorized person.',
      actions: Object.freeze(['Confirm everyone is away from immediate danger', 'Capture the service address and a safe callback path', 'Escalate for authorized human follow-up']),
      turns: Object.freeze([
        Object.freeze({ speaker: 'customer', text: 'A pipe just burst and water is getting close to the electrical panel.' }),
        Object.freeze({ speaker: 'ai', text: 'If there is immediate danger, move to a safe place and contact emergency services. Is everyone safely away from the panel?' }),
        Object.freeze({ speaker: 'customer', text: 'Yes. We shut the door and moved outside.' }),
        Object.freeze({ speaker: 'ai', text: 'Thank you. I would capture the service address and a safe callback number, then mark this for urgent review by an authorized team member.' })
      ])
    }),
    'estimate': Object.freeze({
      label: 'Estimate',
      context: 'A homeowner wants an estimate for a defined home-service project.',
      intent: 'Estimate request',
      qualification: 'Scope, property, and timing questions identified',
      summary: 'The guided call collects estimate inputs without inventing a price or promising availability.',
      actions: Object.freeze(['Clarify the requested scope', 'Record property and timing context', 'Arrange an authorized estimate follow-up']),
      turns: Object.freeze([
        Object.freeze({ speaker: 'customer', text: 'I would like an estimate for replacing the roof on my detached garage.' }),
        Object.freeze({ speaker: 'ai', text: 'I can help organize the request. What is the garage size, roof material, and approximate age?' }),
        Object.freeze({ speaker: 'customer', text: 'It is a two-car garage with asphalt shingles, roughly twenty years old.' }),
        Object.freeze({ speaker: 'ai', text: 'I would record those details and the property address, then route the request for an on-site assessment before any price is offered.' })
      ])
    }),
    'price-shopper': Object.freeze({
      label: 'Price Shopper',
      context: 'A prospective customer asks for a price before the work scope is known.',
      intent: 'Early price comparison',
      qualification: 'Missing scope and site details made explicit',
      summary: 'The guided call acknowledges the price question while keeping the estimate dependent on real job facts.',
      actions: Object.freeze(['Acknowledge the comparison request', 'Collect the minimum job facts', 'Offer a truthful estimate next step']),
      turns: Object.freeze([
        Object.freeze({ speaker: 'customer', text: 'What do you charge to replace a water heater?' }),
        Object.freeze({ speaker: 'ai', text: 'The total depends on the current unit, access, fuel type, and local requirements. May I collect those details for an accurate follow-up?' }),
        Object.freeze({ speaker: 'customer', text: 'It is a gas unit in the basement, but I do not know the size.' }),
        Object.freeze({ speaker: 'ai', text: 'I would note what is known, mark the missing capacity, and avoid inventing a quote before an authorized review.' })
      ])
    }),
    'returning': Object.freeze({
      label: 'Returning Customer',
      context: 'A returning customer needs follow-up on prior work.',
      intent: 'Existing-work follow-up',
      qualification: 'Identity and prior-work lookup required',
      summary: 'The guided call preserves continuity while requiring identity and role checks before exposing any real record.',
      actions: Object.freeze(['Confirm identity through the real workflow', 'Locate the role-authorized work record', 'Record the requested follow-up']),
      turns: Object.freeze([
        Object.freeze({ speaker: 'customer', text: 'Your team repaired our furnace last month, and the same noise is back.' }),
        Object.freeze({ speaker: 'ai', text: 'I can organize the follow-up. In a real workspace, I would first verify the customer and locate the authorized service record.' }),
        Object.freeze({ speaker: 'customer', text: 'The visit was at our Oak Street address.' }),
        Object.freeze({ speaker: 'ai', text: 'I would record the symptom and requested timing without exposing or changing a customer record until verification is complete.' })
      ])
    }),
    'insurance': Object.freeze({
      label: 'Insurance',
      context: 'A homeowner asks about documenting storm-related damage for an insurance process.',
      intent: 'Damage documentation request',
      qualification: 'Incident, property, and documentation needs identified',
      summary: 'The guided call captures factual job context without giving coverage, legal, or claim-handling advice.',
      actions: Object.freeze(['Record when and where the damage occurred', 'List available photos or documents', 'Route the inspection request for human review']),
      turns: Object.freeze([
        Object.freeze({ speaker: 'customer', text: 'A storm damaged our siding, and our insurer asked for contractor documentation.' }),
        Object.freeze({ speaker: 'ai', text: 'I can help organize an inspection request, but I cannot determine coverage. When did the damage occur and which areas are affected?' }),
        Object.freeze({ speaker: 'customer', text: 'Yesterday evening, mostly on the west side.' }),
        Object.freeze({ speaker: 'ai', text: 'I would capture those facts and available photos, then route the request to an authorized person for the next step.' })
      ])
    }),
    'difficult': Object.freeze({
      label: 'Difficult Customer',
      context: 'A frustrated customer wants a clear response about a delayed visit.',
      intent: 'Service recovery request',
      qualification: 'Concern, requested resolution, and urgency captured',
      summary: 'The guided call acknowledges frustration, records facts, and avoids promises that the system cannot authorize.',
      actions: Object.freeze(['Acknowledge the concern', 'Capture the specific missed expectation', 'Escalate without promising an unconfirmed outcome']),
      turns: Object.freeze([
        Object.freeze({ speaker: 'customer', text: 'I waited all afternoon and nobody arrived. I need an answer now.' }),
        Object.freeze({ speaker: 'ai', text: 'I understand why that is frustrating. I can capture exactly what happened and mark it for prompt review.' }),
        Object.freeze({ speaker: 'customer', text: 'The appointment window ended two hours ago.' }),
        Object.freeze({ speaker: 'ai', text: 'I would record the missed window and your requested resolution, then escalate it without promising a time that has not been confirmed.' })
      ])
    }),
    'scheduling-conflict': Object.freeze({
      label: 'Scheduling Conflict',
      context: 'A customer cannot make the current appointment window and needs alternatives.',
      intent: 'Appointment change request',
      qualification: 'Current appointment and preferred alternatives identified',
      summary: 'The guided call captures scheduling preferences without claiming that a calendar change has been committed.',
      actions: Object.freeze(['Confirm the appointment being discussed', 'Capture acceptable alternative windows', 'Request an authorized schedule change']),
      turns: Object.freeze([
        Object.freeze({ speaker: 'customer', text: 'I cannot make tomorrow morning anymore. Can we move the appointment?' }),
        Object.freeze({ speaker: 'ai', text: 'I can organize the request. Which existing appointment are you referring to, and what alternative windows work?' }),
        Object.freeze({ speaker: 'customer', text: 'The plumbing visit at ten. Thursday afternoon or Friday morning would work.' }),
        Object.freeze({ speaker: 'ai', text: 'I would record both preferences and request confirmation from the authorized scheduler rather than claim the appointment changed.' })
      ])
    }),
    'billing': Object.freeze({
      label: 'Billing',
      context: 'A customer has a question about an invoice and needs an authorized review.',
      intent: 'Invoice clarification',
      qualification: 'Invoice reference and disputed item identified',
      summary: 'The guided call captures the billing question without taking payment or exposing financial details.',
      actions: Object.freeze(['Record the invoice reference safely', 'Identify the line item in question', 'Route to an authorized billing reviewer']),
      turns: Object.freeze([
        Object.freeze({ speaker: 'customer', text: 'I have a question about a line item on my latest invoice.' }),
        Object.freeze({ speaker: 'ai', text: 'I can organize that question. Please avoid sharing card or bank information. Which invoice and line item need review?' }),
        Object.freeze({ speaker: 'customer', text: 'It is the labor line on invoice 1042.' }),
        Object.freeze({ speaker: 'ai', text: 'I would record that reference and route the question to an authorized billing reviewer without changing or collecting payment.' })
      ])
    }),
    'custom': Object.freeze({
      label: 'Custom',
      context: 'Use your own fictional customer situation while reviewing the guided pattern.',
      intent: 'Custom service request',
      qualification: 'Intent, job facts, urgency, and next step remain explicit',
      summary: 'The custom path demonstrates the same truthful pattern: capture facts, identify what is missing, and leave consequential action to an authorized person.',
      actions: Object.freeze(['State the fictional customer need', 'Identify known and missing job facts', 'Choose an accountable next step']),
      turns: Object.freeze([
        Object.freeze({ speaker: 'customer', text: 'I have a home-service request that does not fit the other examples.' }),
        Object.freeze({ speaker: 'ai', text: 'Please describe the work, location, timing, and any immediate safety concern.' }),
        Object.freeze({ speaker: 'customer', text: 'The work is not urgent, but I would like someone to review it next week.' }),
        Object.freeze({ speaker: 'ai', text: 'I would capture the available facts, mark what is still missing, and route a clear next action for authorized review.' })
      ])
    })
  });

  var currentScenario = 'emergency';
  var previousFocus = null;
  var connectionTimer = null;
  var renderTimer = null;

  function byId(id) {
    return global.document.getElementById(id);
  }

  function setText(id, value) {
    var element = byId(id);
    if (element) element.textContent = value;
  }

  function setNotice(id, message, state) {
    var element = byId(id);
    if (!element) return;
    element.textContent = message || '';
    if (state) element.setAttribute('data-state', state);
    else element.removeAttribute('data-state');
  }

  function rememberSelection() {
    try {
      global.sessionStorage.setItem('northstar.homepage.scenario', currentScenario);
      var industry = byId('demoIndustry');
      if (industry && industry.value) global.sessionStorage.setItem('northstar.homepage.industry', industry.value);
    } catch (_error) {}
  }

  function syncScenarioButtons() {
    Array.prototype.forEach.call(global.document.querySelectorAll('[data-scenario]'), function (button) {
      var active = button.getAttribute('data-scenario') === currentScenario;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    var scenario = SCENARIOS[currentScenario];
    setText('selectedScenarioContext', scenario.label + ': ' + scenario.context);
  }

  function setScenario(key) {
    if (!Object.prototype.hasOwnProperty.call(SCENARIOS, key)) return false;
    currentScenario = key;
    syncScenarioButtons();
    rememberSelection();
    return true;
  }

  function validateForm() {
    var businessName = byId('demoBusinessName');
    var industry = byId('demoIndustry');
    if (!businessName || !businessName.value.trim()) {
      setNotice('demoFormNotice', 'Enter a business name to frame the fictional preview.', 'error');
      if (businessName) businessName.focus();
      return null;
    }
    if (!industry || !industry.value) {
      setNotice('demoFormNotice', 'Select one of the seven supported preview industries.', 'error');
      if (industry) industry.focus();
      return null;
    }
    setNotice('demoFormNotice', 'Ready. Review the coaching tip before starting.', 'success');
    rememberSelection();
    return { businessName: businessName.value.trim(), industry: industry.value };
  }

  function focusableInDialog() {
    var dialog = byId('preCallModal');
    if (!dialog) return [];
    return Array.prototype.filter.call(dialog.querySelectorAll('button, [href], input, select, [tabindex]'), function (element) {
      return !element.disabled && element.getAttribute('tabindex') !== '-1' && !element.hidden;
    });
  }

  function handleDialogKeydown(event) {
    var dialog = byId('preCallModal');
    if (!dialog || dialog.getAttribute('aria-hidden') !== 'false') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog(true);
      return;
    }
    if (event.key !== 'Tab') return;
    var focusable = focusableInDialog();
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && global.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && global.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openDialog() {
    var dialog = byId('preCallModal');
    if (!dialog) return;
    var active = global.document.activeElement;
    previousFocus = active && active !== global.document.body ? active : byId('demoCallBtn');
    syncScenarioButtons();
    dialog.classList.add('active');
    dialog.setAttribute('aria-hidden', 'false');
    global.document.addEventListener('keydown', handleDialogKeydown);
    var primary = byId('modalCallBtn');
    if (primary) primary.focus();
  }

  function closeDialog(returnFocus) {
    var dialog = byId('preCallModal');
    if (!dialog) return;
    dialog.classList.remove('active');
    dialog.setAttribute('aria-hidden', 'true');
    global.document.removeEventListener('keydown', handleDialogKeydown);
    if (returnFocus && previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  }

  function showPreCallModal() {
    var values = validateForm();
    if (!values) return;
    openDialog();
  }

  function clearPreviewTimers() {
    if (connectionTimer) global.clearTimeout(connectionTimer);
    if (renderTimer) global.clearTimeout(renderTimer);
    connectionTimer = null;
    renderTimer = null;
  }

  function showPreviewView() {
    var pre = byId('demoPreCallView');
    var live = byId('demoLiveView');
    var post = byId('demoPostCallView');
    if (pre) pre.style.display = 'none';
    if (live) live.style.display = 'block';
    if (post) post.style.display = 'none';
    ['callStateDialing', 'callStateRinging', 'callStateAnswered'].forEach(function (id) {
      var state = byId(id);
      if (state) state.classList.remove('active');
    });
    var header = byId('demoLiveHeader');
    if (header) header.style.display = 'block';
    var actions = byId('guidedPreviewActions');
    if (actions) actions.hidden = true;
  }

  function renderActions(actions) {
    var list = byId('demoActions');
    if (!list) return;
    var nodes = actions.map(function (action) {
      var item = global.document.createElement('li');
      item.textContent = action;
      return item;
    });
    list.replaceChildren.apply(list, nodes);
  }

  function failPreview(message) {
    clearPreviewTimers();
    setText('demoStatusLabel', 'Preview needs another try');
    setNotice('guidedPreviewNotice', message, 'error');
    var button = byId('demoCallBtn');
    if (button) {
      button.disabled = false;
      button.textContent = 'Start Guided Call';
    }
    var actions = byId('guidedPreviewActions');
    if (actions) actions.hidden = false;
  }

  function renderScenario(values, scenario) {
    if (!global.NorthStarTranscriptRenderer || typeof global.NorthStarTranscriptRenderer.render !== 'function') {
      failPreview('The safe transcript renderer is unavailable. Reload the page and try again.');
      return;
    }
    clearPreviewTimers();
    var transcript = byId('demoTranscriptBody');
    var result = global.NorthStarTranscriptRenderer.render(transcript, scenario.turns, {
      labels: { ai: 'NorthStar guide', customer: 'Customer', system: '' },
      live: 'polite',
      scroll: 'top'
    });
    setText('demoTranscriptCount', result.count + (result.count === 1 ? ' message' : ' messages'));
    setText('demoStatusLabel', scenario.label + ' guided call ready');
    setText('demoLiveTimer', 'Browser-only');
    var dot = byId('demoStatusDot');
    if (dot) dot.className = 'demo-status-ended';
    setText('demoIntent', scenario.intent);
    setText('demoQualification', scenario.qualification);
    setText('demoBookingProb', 'Not calculated in guided preview');
    setText('demoPolarisRevenue', 'Not calculated in guided preview');
    setText('demoPolarisConfidence', '—');
    setText('demoSummary', values.businessName + ' · ' + values.industry + ': ' + scenario.summary);
    renderActions(scenario.actions);
    setNotice('guidedPreviewNotice', 'Preview ready. No call was placed and no data was sent or stored.', 'success');
    var actions = byId('guidedPreviewActions');
    if (actions) actions.hidden = false;
    var button = byId('demoCallBtn');
    if (button) {
      button.disabled = false;
      button.textContent = 'Start Guided Call';
    }
    var live = byId('demoLiveView');
    if (live) live.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function executeDemoCall() {
    var values = validateForm();
    if (!values) {
      closeDialog(false);
      return;
    }
    var scenario = SCENARIOS[currentScenario];
    closeDialog(false);
    clearPreviewTimers();
    showPreviewView();
    setText('demoStatusLabel', 'Preparing ' + scenario.label.toLowerCase() + ' guided call...');
    setText('demoLiveTimer', 'Browser-only');
    setNotice('guidedPreviewNotice', 'Preparing the fictional conversation in this browser...', '');
    var button = byId('demoCallBtn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Preparing Browser Preview...';
    }
    connectionTimer = global.setTimeout(function () {
      failPreview('The guided call took too long to start. Return to the form and try again.');
    }, CONNECTION_TIMEOUT_MS);
    renderTimer = global.setTimeout(function () {
      renderScenario(values, scenario);
    }, 120);
  }

  function returnToForm(openCoaching) {
    clearPreviewTimers();
    var pre = byId('demoPreCallView');
    var live = byId('demoLiveView');
    var post = byId('demoPostCallView');
    if (pre) pre.style.display = 'block';
    if (live) live.style.display = 'none';
    if (post) post.style.display = 'none';
    if (pre) pre.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (openCoaching) showPreCallModal();
  }

  function launchNewScenario(scenarioType) {
    setScenario(scenarioType);
    returnToForm(true);
  }

  function resetDemo() {
    clearPreviewTimers();
    closeDialog(false);
    var businessName = byId('demoBusinessName');
    var industry = byId('demoIndustry');
    if (businessName) businessName.value = '';
    if (industry) industry.value = '';
    setNotice('demoFormNotice', '', '');
    setNotice('guidedPreviewNotice', '', '');
    setScenario('emergency');
    returnToForm(false);
    if (businessName) businessName.focus();
  }

  function ownScenarioButtons(selector) {
    Array.prototype.forEach.call(global.document.querySelectorAll(selector), function (button) {
      var owned = button.cloneNode(true);
      button.parentNode.replaceChild(owned, button);
      owned.addEventListener('click', function () {
        setScenario(owned.getAttribute('data-scenario'));
      });
    });
  }

  function restoreSelection() {
    try {
      var storedScenario = global.sessionStorage.getItem('northstar.homepage.scenario');
      if (storedScenario && Object.prototype.hasOwnProperty.call(SCENARIOS, storedScenario)) currentScenario = storedScenario;
      var storedIndustry = global.sessionStorage.getItem('northstar.homepage.industry');
      var industry = byId('demoIndustry');
      if (industry && storedIndustry && Array.prototype.some.call(industry.options, function (option) { return option.value === storedIndustry; })) {
        industry.value = storedIndustry;
      }
    } catch (_error) {}
  }

  function initialize() {
    ownScenarioButtons('#scenarioChips [data-scenario]');
    ownScenarioButtons('#modalScenarioChips [data-scenario]');
    restoreSelection();
    syncScenarioButtons();
    var cancel = byId('modalCancelBtn');
    if (cancel) cancel.addEventListener('click', function () { closeDialog(true); });
    var tryAnother = byId('guidedTryAnother');
    if (tryAnother) tryAnother.addEventListener('click', function () { returnToForm(true); });
    var industry = byId('demoIndustry');
    if (industry) industry.addEventListener('change', rememberSelection);
    var dialog = byId('preCallModal');
    if (dialog) dialog.setAttribute('aria-hidden', 'true');
    if (global.NorthStarTheme && typeof global.NorthStarTheme.refreshControlPosition === 'function') {
      global.NorthStarTheme.refreshControlPosition();
    }
  }

  global.showPreCallModal = showPreCallModal;
  global.startDemoCall = showPreCallModal;
  global.executeDemoCall = executeDemoCall;
  global.launchNewScenario = launchNewScenario;
  global.resetDemo = resetDemo;
  global.NorthStarHomepageDemo = Object.freeze({
    connectionTimeoutMs: CONNECTION_TIMEOUT_MS,
    scenarios: SCENARIOS,
    selectScenario: setScenario,
    start: showPreCallModal,
    reset: resetDemo
  });

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})(window);
